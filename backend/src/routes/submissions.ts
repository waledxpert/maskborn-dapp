import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GeneratorCategory, Prisma, SubmissionKind } from "../generated/prisma/client.js";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { ApiError } from "../errors.js";
import { requireVerifiedDiscord } from "../middleware/auth.js";
import { objectStorage } from "../object-storage.js";
import {
  createSubmissionPreview,
  createTraitPreviewVariants,
  normalizeAccessoryName,
  normalizeSubmissionTitle,
  sourcePixelDataSchema,
} from "../submission-art.js";
import { asyncRoute, requestHash, retryOnWriteConflict, slugify } from "../utils.js";

export const submissionsRouter = Router();

const submissionBody = z.object({
  kind: z.nativeEnum(SubmissionKind),
  title: z.string().trim().min(2).max(100),
  description: z.string()
    .trim()
    .min(1, "Add a description.")
    .max(1200)
    .refine(
      (value) => value.split(/\s+/).filter(Boolean).length <= 50,
      "Description must be 50 words or fewer.",
    ),
  generatorVersion: z.string().min(1).max(100),
  categories: z.array(z.nativeEnum(GeneratorCategory)).min(1).max(8),
  pixelData: sourcePixelDataSchema,
  compatibility: z.record(z.string(), z.unknown()).optional(),
  mediaHash: z.string().regex(/^[a-f0-9]{64}$/i),
  previewAssetUrl: z.string().url().max(150_000).refine(
    (value) => value.startsWith("data:image/svg+xml"),
    "The publish preview must be an SVG data URL.",
  ),
  sourcePostUrl: z.string().url().max(2048).optional(),
});
const communityTraitCategories = new Set<GeneratorCategory>(["BACKGROUND", "EYES", "HATS", "SPECIAL"]);
let baseMarkupPromise: Promise<string> | null = null;

const nameAvailabilityQuery = z.object({
  category: z.nativeEnum(GeneratorCategory).refine(
    (category) => communityTraitCategories.has(category),
    "Choose Background, Eyes, Hats, or Special.",
  ),
  name: z.string().trim().min(2).max(40),
});
const titleAvailabilityQuery = z.object({
  title: z.string().trim().min(2).max(100),
});

function getBaseMarkup() {
  baseMarkupPromise ??= readFile(path.resolve("assets", "base.svg"), "utf8")
    .then((source) => source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""));
  return baseMarkupPromise;
}

function decodeSvgDataUrl(value: string) {
  const comma = value.indexOf(",");
  if (comma === -1) throw new ApiError(422, "PREVIEW_INVALID", "The SVG preview could not be decoded.");
  const metadata = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  try {
    return Buffer.from(metadata.includes(";base64") ? payload : decodeURIComponent(payload), metadata.includes(";base64") ? "base64" : "utf8");
  } catch {
    throw new ApiError(422, "PREVIEW_INVALID", "The SVG preview could not be decoded.");
  }
}

submissionsRouter.get("/submissions/name-availability", requireVerifiedDiscord, asyncRoute(async (req, res) => {
  const query = nameAvailabilityQuery.parse(req.query);
  const normalizedName = normalizeAccessoryName(query.name);
  const existing = await db.submissionAccessory.findUnique({
    where: {
      category_normalizedName: {
        category: query.category,
        normalizedName,
      },
    },
    select: { id: true },
  });
  res.json({ available: !existing, normalizedName });
}));

submissionsRouter.get("/submissions/title-availability", requireVerifiedDiscord, asyncRoute(async (req, res) => {
  const { title } = titleAvailabilityQuery.parse(req.query);
  const normalizedTitle = normalizeSubmissionTitle(title);
  const existing = await db.submission.findFirst({
    where: {
      OR: [
        { titleClaim: normalizedTitle },
        { title: { equals: title.trim().replace(/\s+/g, " "), mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  res.json({ available: !existing, normalizedTitle });
}));

submissionsRouter.post("/submissions", requireVerifiedDiscord, asyncRoute(async (req, res) => {
  const body = submissionBody.parse(req.body);
  const userId = req.auth!.userId;
  const normalizedTitle = normalizeSubmissionTitle(body.title);
  if (body.kind === "TRAIT_EXTENSION") {
    const unsupported = body.categories.filter((category) => !communityTraitCategories.has(category));
    if (unsupported.length > 0) {
      throw new ApiError(422, "UNSUPPORTED_TRAIT_CATEGORY", "Trait submissions can contain only Background, Eyes, Hats, and Special.");
    }
  }
  const key = req.header("idempotency-key");
  if (!key || key.length > 100) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send a unique Idempotency-Key when publishing.");
  }
  if (body.kind === "TRAIT_EXTENSION" && !body.compatibility) {
    throw new ApiError(422, "COMPATIBILITY_REQUIRED", "Trait extensions need completed compatibility results.");
  }

  const scope = "publish-submission";
  const hash = requestHash(body);
  const prior = await db.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope, key } } });
  if (prior) {
    if (prior.requestHash !== hash) {
      throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "That key was used for a different submission.");
    }
    res.status(prior.responseCode ?? 201).json(prior.responseBody);
    return;
  }
  const sourceBody = Buffer.from(`${JSON.stringify(body.pixelData, null, 2)}\n`, "utf8");
  const sourceHash = createHash("sha256").update(sourceBody).digest("hex");
  const suppliedPreviewBody = decodeSvgDataUrl(body.previewAssetUrl);
  const suppliedMediaHash = createHash("sha256").update(suppliedPreviewBody).digest("hex");
  if (suppliedMediaHash !== body.mediaHash.toLowerCase()) {
    throw new ApiError(422, "MEDIA_HASH_MISMATCH", "The preview hash does not match the uploaded artwork.");
  }
  const baseMarkup = await getBaseMarkup();
  const previewBody = Buffer.from(createSubmissionPreview(
    body.pixelData,
    baseMarkup,
    body.kind === "TRAIT_EXTENSION" || !body.pixelData.startBlank,
  ), "utf8");
  const calculatedMediaHash = createHash("sha256").update(previewBody).digest("hex");
  if (calculatedMediaHash !== suppliedMediaHash) {
    throw new ApiError(
      422,
      "PREVIEW_SOURCE_MISMATCH",
      "The preview does not match the submitted pixel layers. Rebuild the preview and try again.",
    );
  }
  const pixelDataKey = `submissions/${userId}/${sourceHash}/source.json`;
  const previewAssetKey = `submissions/${userId}/${calculatedMediaHash}/preview.svg`;

  const result = await retryOnWriteConflict(() => db.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${userId}))::text AS locked
    `;
    const concurrentPrior = await tx.idempotencyRecord.findUnique({
      where: { userId_scope_key: { userId, scope, key } },
    });
    if (concurrentPrior) {
      if (concurrentPrior.requestHash !== hash) {
        throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "That key was used for a different submission.");
      }
      return {
        statusCode: concurrentPrior.responseCode ?? 201,
        response: concurrentPrior.responseBody,
      };
    }

    const existingSubmission = await tx.submission.findUnique({
      where: {
        userId_mediaHash: {
          userId,
          mediaHash: calculatedMediaHash,
        },
      },
    });
    if (existingSubmission) {
      const response = { submission: existingSubmission, duplicate: true };
      await tx.idempotencyRecord.create({
        data: {
          userId,
          scope,
          key,
          requestHash: hash,
          responseCode: 200,
          responseBody: response,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      return { statusCode: 200, response };
    }
    const existingTitle = await tx.submission.findFirst({
      where: {
        OR: [
          { titleClaim: normalizedTitle },
          { title: { equals: body.title.trim().replace(/\s+/g, " "), mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (existingTitle) {
      throw new ApiError(409, "SUBMISSION_TITLE_TAKEN", "That artwork title is already in use. Choose a different title.");
    }

    const categories = [...new Set(body.categories)];
    const drawnLayers = body.pixelData.layers.filter((layer) => layer.visible && layer.pixels.length > 0);
    const drawnCategories = [...new Set(drawnLayers.map((layer) => layer.kind.toUpperCase() as GeneratorCategory))];
    if (
      drawnCategories.length !== categories.length
      || drawnCategories.some((category) => !categories.includes(category))
    ) {
      throw new ApiError(
        422,
        "DRAWN_CATEGORIES_MISMATCH",
        "Submitted trait categories must exactly match the visible layers containing pixels.",
        { submitted: categories, drawn: drawnCategories },
      );
    }
    const namedAccessories = body.kind === "TRAIT_EXTENSION"
      ? drawnLayers.map((layer) => ({
        category: layer.kind.toUpperCase() as GeneratorCategory,
        name: layer.name.trim().replace(/\s+/g, " "),
        normalizedName: normalizeAccessoryName(layer.name),
      }))
      : [];
    const repeatedCategory = namedAccessories.find((accessory, index) =>
      namedAccessories.findIndex((candidate) => candidate.category === accessory.category) !== index);
    if (repeatedCategory) {
      throw new ApiError(
        422,
        "ONE_ACCESSORY_PER_CATEGORY",
        `Add only one ${repeatedCategory.category.toLowerCase()} accessory per submission.`,
      );
    }
    const localNameKeys = namedAccessories.map((accessory) => `${accessory.category}:${accessory.normalizedName}`);
    const repeatedLocalName = localNameKeys.find((value, index) => localNameKeys.indexOf(value) !== index);
    if (repeatedLocalName) {
      throw new ApiError(422, "ACCESSORY_NAME_REPEATED", "Each accessory in a category needs a different name.");
    }
    if (namedAccessories.length > 0) {
      const takenNames = await tx.submissionAccessory.findMany({
        where: {
          OR: namedAccessories.map((accessory) => ({
            category: accessory.category,
            normalizedName: accessory.normalizedName,
          })),
        },
        select: { category: true, name: true, normalizedName: true },
      });
      if (takenNames.length > 0) {
        throw new ApiError(
          409,
          "ACCESSORY_NAME_TAKEN",
          `Already taken: ${takenNames.map((item) => `${item.name} (${item.category.toLowerCase()})`).join(", ")}.`,
          { names: takenNames },
        );
      }
    }

    if (body.kind === "ONE_OF_ONE") {
      const oneOfOneCount = await tx.submission.count({ where: { userId, kind: "ONE_OF_ONE" } });
      if (oneOfOneCount >= 2) {
        throw new ApiError(409, "SUBMISSION_LIMIT_REACHED", "Both lifetime 1/1 submission slots are already used.");
      }
    } else {
      const priorTraitSubmissions = await tx.submission.findMany({
        where: { userId, kind: "TRAIT_EXTENSION", categories: { hasSome: categories } },
        select: { categories: true },
      });
      const previouslySubmitted = new Set(priorTraitSubmissions.flatMap((submission) => submission.categories));
      const repeatedCategories = categories.filter((category) => previouslySubmitted.has(category));
      if (repeatedCategories.length > 0) {
        throw new ApiError(
          409,
          "TRAIT_CATEGORY_ALREADY_SUBMITTED",
          `You have already submitted: ${repeatedCategories.map((category) => category.toLowerCase()).join(", ")}.`,
          { categories: repeatedCategories },
        );
      }
    }

    const restriction = await tx.voteRestriction.findFirst({
      where: { userId, type: { in: ["SUBMISSION", "ACCOUNT"] }, liftedAt: null, expiresAt: { gt: new Date() } },
    });
    if (restriction) {
      throw new ApiError(429, "SUBMISSION_RESTRICTED", "Publishing is temporarily paused.", { expiresAt: restriction.expiresAt });
    }

    await Promise.all([
      objectStorage.putPrivate(pixelDataKey, sourceBody, "application/json; charset=utf-8"),
      objectStorage.putPublic(previewAssetKey, previewBody, "image/svg+xml; charset=utf-8"),
    ]);
    const previewVariants = body.kind === "TRAIT_EXTENSION"
      ? createTraitPreviewVariants(body.pixelData, baseMarkup)
      : [];
    const storedVariants = await Promise.all(previewVariants.map(async (variant) => {
      const key = `submissions/${userId}/${sourceHash}/variants/${variant.id}.svg`;
      await objectStorage.putPublic(key, Buffer.from(variant.svg, "utf8"), "image/svg+xml; charset=utf-8");
      return {
        id: variant.id,
        label: variant.label,
        categories: variant.categories,
        url: objectStorage.publicUrl(key),
      };
    }));
    const previewAssetUrl = objectStorage.publicUrl(previewAssetKey);
    const slug = `${slugify(body.title)}-${randomBytes(3).toString("hex")}`;
    const submission = await tx.submission.create({
      data: {
        userId,
        slug,
        kind: body.kind,
        title: body.title,
        titleClaim: normalizedTitle,
        description: body.description,
        generatorVersion: body.generatorVersion,
        categories,
        pixelData: {
          schemaVersion: body.pixelData.schemaVersion ?? 1,
          objectKey: pixelDataKey,
          sha256: sourceHash,
          byteLength: sourceBody.byteLength,
        } as Prisma.InputJsonValue,
        pixelDataKey,
        sourceHash,
        compatibility: body.compatibility as Prisma.InputJsonValue | undefined,
        mediaHash: calculatedMediaHash,
        previewAssetUrl,
        previewAssetKey,
        previewVariants: storedVariants as Prisma.InputJsonValue,
        storageProvider: objectStorage.provider,
        sourcePostUrl: body.sourcePostUrl,
      },
    });
    if (namedAccessories.length > 0) {
      await tx.submissionAccessory.createMany({
        data: namedAccessories.map((accessory) => ({
          submissionId: submission.id,
          ...accessory,
        })),
      });
    }
    await tx.submissionStatusEvent.create({
      data: {
        submissionId: submission.id,
        toStatus: "PENDING",
        actorId: userId,
        note: "Published by creator",
      },
    });
    const response = { submission };
    await tx.idempotencyRecord.create({
      data: {
        userId, scope, key, requestHash: hash, responseCode: 201,
        responseBody: response, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { statusCode: 201, response };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 30_000,
  }));

  res.status(result.statusCode).json(result.response);
}));
