import { Router } from "express";
import { GalleryEntryKind, GeneratorCategory, Prisma, PublicationState, RestrictionType } from "../generated/prisma/client.js";
import { z } from "zod";
import { db } from "../db.js";
import { ApiError } from "../errors.js";
import { requireAdmin, requireVerifiedDiscord } from "../middleware/auth.js";
import { objectStorage } from "../object-storage.js";
import { asyncRoute } from "../utils.js";

export const adminRouter = Router();
adminRouter.use(requireVerifiedDiscord, requireAdmin);

adminRouter.get("/access", (_req, res) => {
  res.json({ authorized: true });
});

const reviewQueueQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(6).max(48).default(12),
  sort: z.enum(["time", "votes"]).default("time"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  search: z.string().trim().max(80).default(""),
});

adminRouter.get("/review-queue", asyncRoute(async (req, res) => {
  const query = reviewQueueQuery.parse(req.query);
  const where: Prisma.SubmissionWhereInput = {
    status: { in: ["PENDING", "REVIEWING", "ACCEPTED"] },
    ...(query.search ? {
      OR: [
        { title: { contains: query.search, mode: "insensitive" as const } },
        { description: { contains: query.search, mode: "insensitive" as const } },
        { user: { displayName: { contains: query.search, mode: "insensitive" as const } } },
        { user: { socialAccounts: { some: { provider: "X_MANUAL", username: { contains: query.search, mode: "insensitive" as const } } } } },
      ],
    } : {}),
  };
  const orderBy = query.sort === "votes"
    ? [{ upvoteCount: query.direction }, { publishedAt: "desc" as const }]
    : [{ publishedAt: query.direction }, { id: query.direction }];
  const [total, items] = await db.$transaction([
    db.submission.count({ where }),
    db.submission.findMany({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy,
      include: {
        user: { select: { id: true, displayName: true, socialAccounts: { where: { provider: "X_MANUAL" }, take: 1 } } },
      },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / query.limit));
  res.json({ items, pagination: { page: Math.min(query.page, pages), pages, total, limit: query.limit } });
}));

const acceptToGalleryBody = z.object({
  categories: z.array(z.nativeEnum(GeneratorCategory)).max(8).default([]),
  note: z.string().trim().min(2).max(1000),
});

adminRouter.post("/submissions/:id/accept-to-gallery", asyncRoute(async (req, res) => {
  const body = acceptToGalleryBody.parse(req.body);
  const submissionId = req.params.id as string;
  const entry = await db.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "That submission was not found.");
    if (["GALLERY_ADDED", "WITHDRAWN", "REJECTED"].includes(submission.status)) {
      throw new ApiError(409, "SUBMISSION_STATE_INVALID", `A ${submission.status.toLowerCase()} submission cannot be added.`);
    }
    const existingEntry = await tx.galleryEntry.findUnique({ where: { submissionId: submission.id }, select: { id: true } });
    if (existingEntry) {
      throw new ApiError(409, "GALLERY_ENTRY_EXISTS", "That submission is already in the gallery.");
    }

    const selectedCategories = submission.kind === "ONE_OF_ONE"
      ? submission.categories
      : [...new Set(body.categories)];
    if (submission.kind === "TRAIT_EXTENSION") {
      if (selectedCategories.length === 0) {
        throw new ApiError(422, "GALLERY_TRAIT_REQUIRED", "Select at least one submitted trait.");
      }
      const invalid = selectedCategories.filter((category) => !submission.categories.includes(category));
      if (invalid.length) {
        throw new ApiError(422, "GALLERY_TRAIT_INVALID", "Only traits included in this submission can be accepted.", {
          categories: invalid,
        });
      }
    }

    const created = await tx.galleryEntry.create({
      data: {
        submissionId: submission.id,
        kind: submission.kind === "ONE_OF_ONE" ? "ONE_OF_ONE" : "TRAIT",
        publicationState: "GALLERY_ONLY",
        categories: selectedCategories,
      },
    });
    await tx.submission.update({ where: { id: submission.id }, data: { status: "GALLERY_ADDED" } });
    await tx.submissionStatusEvent.create({
      data: {
        submissionId: submission.id,
        actorId: req.auth!.userId,
        fromStatus: submission.status,
        toStatus: "GALLERY_ADDED",
        note: body.note,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: "SUBMISSION_ACCEPTED_TO_GALLERY",
        targetType: "GalleryEntry",
        targetId: created.id,
        before: { submissionStatus: submission.status, submittedCategories: submission.categories },
        after: { submissionStatus: "GALLERY_ADDED", acceptedCategories: selectedCategories },
        reason: body.note,
        requestId: req.id,
      },
    });
    return created;
  });
  res.status(201).json({ entry });
}));

const abuseQuery = z.object({
  query: z.string().trim().max(80).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

adminRouter.get("/abuse", asyncRoute(async (req, res) => {
  const { query, limit } = abuseQuery.parse(req.query);
  const now = new Date();
  const recentSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const where = query ? {
    OR: [
      { id: { contains: query, mode: "insensitive" as const } },
      { displayName: { contains: query, mode: "insensitive" as const } },
      { socialAccounts: { some: { username: { contains: query, mode: "insensitive" as const } } } },
      { wallets: { some: { address: { contains: query, mode: "insensitive" as const } } } },
    ],
  } : {
    OR: [
      { riskEvents: { some: { createdAt: { gte: recentSince } } } },
      { restrictions: { some: { liftedAt: null, expiresAt: { gt: now } } } },
    ],
  };
  const users = await db.user.findMany({
    where,
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      role: true,
      displayName: true,
      avatarUrl: true,
      createdAt: true,
      socialAccounts: { select: { provider: true, username: true }, take: 4 },
      wallets: { select: { address: true }, take: 2 },
      restrictions: {
        where: { liftedAt: null, expiresAt: { gt: now } },
        orderBy: { expiresAt: "desc" },
        select: { id: true, type: true, reasonCode: true, note: true, expiresAt: true },
      },
      riskEvents: {
        where: { createdAt: { gte: recentSince } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, eventType: true, score: true, createdAt: true, metadata: true },
      },
      _count: { select: { submissions: true, votes: true, voteEvents: true } },
    },
  });
  const items = users
    .map((user) => ({
      ...user,
      recentRiskScore: user.riskEvents.reduce((total, event) => total + event.score, 0),
    }))
    .sort((a, b) => b.recentRiskScore - a.recentRiskScore);
  res.json({ items });
}));

const restrictBody = z.object({
  type: z.nativeEnum(RestrictionType),
  hours: z.number().int().min(1).max(24 * 365),
  reason: z.string().trim().min(4).max(500),
});

adminRouter.post("/users/:id/restrict", asyncRoute(async (req, res) => {
  const body = restrictBody.parse(req.body);
  const userId = req.params.id as string;
  const expiresAt = new Date(Date.now() + body.hours * 60 * 60 * 1000);
  const restriction = await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "That user was not found.");
    if (user.role === "ADMIN") {
      throw new ApiError(403, "ADMIN_RESTRICTION_FORBIDDEN", "Administrator accounts cannot be restricted here.");
    }
    const active = await tx.voteRestriction.findMany({
      where: { userId, type: body.type, liftedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, expiresAt: true },
    });
    if (active.length) {
      await tx.voteRestriction.updateMany({
        where: { id: { in: active.map((item) => item.id) } },
        data: { liftedAt: new Date(), note: "Superseded by a newer administrator restriction." },
      });
    }
    const created = await tx.voteRestriction.create({
      data: {
        userId,
        type: body.type,
        reasonCode: "ADMIN_ACTION",
        note: body.reason,
        expiresAt,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: "USER_RESTRICTED",
        targetType: "User",
        targetId: userId,
        before: { supersededRestrictions: active },
        after: { restrictionId: created.id, type: created.type, expiresAt: created.expiresAt },
        reason: body.reason,
        requestId: req.id,
      },
    });
    return created;
  });
  res.status(201).json({ restriction });
}));

adminRouter.get("/submissions/:id/source", asyncRoute(async (req, res) => {
  const submission = await db.submission.findUnique({ where: { id: req.params.id as string } });
  if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "That submission was not found.");
  if (!submission.pixelDataKey) {
    res.json({ pixelData: submission.pixelData, sha256: submission.sourceHash, storageProvider: "DATABASE" });
    return;
  }
  const stored = await objectStorage.getPrivate(submission.pixelDataKey);
  const pixelData = JSON.parse(stored.body.toString("utf8")) as unknown;
  res.json({ pixelData, sha256: submission.sourceHash, storageProvider: submission.storageProvider });
}));

const reviewBody = z.object({
  decision: z.enum(["ACCEPTED", "REJECTED", "REVIEWING"]),
  note: z.string().trim().min(2).max(1000),
});

adminRouter.put("/submissions/:id/review", asyncRoute(async (req, res) => {
  const body = reviewBody.parse(req.body);
  const submissionId = req.params.id as string;
  const result = await db.$transaction(async (tx) => {
    const current = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!current) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "That submission was not found.");
    if (["GALLERY_ADDED", "WITHDRAWN"].includes(current.status)) {
      throw new ApiError(409, "SUBMISSION_STATE_INVALID", `A ${current.status.toLowerCase()} submission cannot be reviewed.`);
    }
    const updated = await tx.submission.update({ where: { id: current.id }, data: { status: body.decision } });
    await tx.submissionStatusEvent.create({
      data: {
        submissionId: current.id,
        actorId: req.auth!.userId,
        fromStatus: current.status,
        toStatus: body.decision,
        note: body.note,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: "SUBMISSION_REVIEWED",
        targetType: "Submission",
        targetId: current.id,
        before: { status: current.status },
        after: { status: body.decision },
        reason: body.note,
        requestId: req.id,
      },
    });
    return updated;
  });
  res.json({ submission: result });
}));

const promoteBody = z.object({
  kind: z.nativeEnum(GalleryEntryKind),
  publicationState: z.nativeEnum(PublicationState).default("GALLERY_ONLY"),
  categories: z.array(z.nativeEnum(GeneratorCategory)).min(1).max(8),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().min(2).max(1000),
  onchain: z.object({
    chainId: z.number().int().positive(),
    contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    tokenId: z.string().regex(/^\d+$/),
    metadataUri: z.string().url().optional(),
  }).optional(),
  feeShare: z.object({
    walletId: z.string().cuid(),
    basisPoints: z.number().int().min(1).max(10_000),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.publicationState === "ONCHAIN_EXTENSION" && !value.onchain) {
    ctx.addIssue({ code: "custom", message: "Onchain publication data is required.", path: ["onchain"] });
  }
  if (value.feeShare && value.kind !== "ONE_OF_ONE") {
    ctx.addIssue({ code: "custom", message: "Creator fee shares currently apply only to 1/1s.", path: ["feeShare"] });
  }
  if (value.feeShare && value.publicationState !== "ONCHAIN_EXTENSION") {
    ctx.addIssue({ code: "custom", message: "A gallery-only item cannot accrue onchain fees.", path: ["feeShare"] });
  }
});

adminRouter.post("/submissions/:id/promote", asyncRoute(async (req, res) => {
  const body = promoteBody.parse(req.body);
  const submissionId = req.params.id as string;
  const entry = await db.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "That submission was not found.");
    if (submission.status !== "ACCEPTED") {
      throw new ApiError(409, "SUBMISSION_NOT_ACCEPTED", "Accept the submission before adding it to the gallery.");
    }
    const existingEntry = await tx.galleryEntry.findUnique({ where: { submissionId: submission.id }, select: { id: true } });
    if (existingEntry) {
      throw new ApiError(409, "GALLERY_ENTRY_EXISTS", "That submission is already in the gallery.");
    }
    if (body.onchain) {
      const existingToken = await tx.galleryEntry.findFirst({
        where: {
          tokenChainId: body.onchain.chainId,
          tokenContract: body.onchain.contract.toLowerCase(),
          tokenId: body.onchain.tokenId,
        },
        select: { id: true },
      });
      if (existingToken) {
        throw new ApiError(409, "ONCHAIN_TOKEN_ALREADY_REGISTERED", "That on-chain token is already registered in the gallery.");
      }
    }
    const selectedCategories = [...new Set(body.categories)];
    const invalidCategories = selectedCategories.filter((category) => !submission.categories.includes(category));
    if (invalidCategories.length) {
      throw new ApiError(422, "GALLERY_TRAIT_INVALID", "Only traits included in this submission can be promoted.", {
        categories: invalidCategories,
      });
    }
    if (body.feeShare) {
      const wallet = await tx.wallet.findFirst({ where: { id: body.feeShare.walletId, userId: submission.userId } });
      if (!wallet) throw new ApiError(422, "CREATOR_WALLET_INVALID", "The fee-share wallet must belong to the creator.");
    }

    const created = await tx.galleryEntry.create({
      data: {
        submissionId: submission.id,
        kind: body.kind,
        publicationState: body.publicationState,
        categories: selectedCategories,
        displayOrder: body.displayOrder,
        tokenChainId: body.onchain?.chainId,
        tokenContract: body.onchain?.contract.toLowerCase(),
        tokenId: body.onchain?.tokenId,
        metadataUri: body.onchain?.metadataUri,
        feeShare: body.feeShare ? {
          create: { walletId: body.feeShare.walletId, basisPoints: body.feeShare.basisPoints },
        } : undefined,
      },
      include: { feeShare: true },
    });
    await tx.submission.update({ where: { id: submission.id }, data: { status: "GALLERY_ADDED" } });
    await tx.submissionStatusEvent.create({
      data: {
        submissionId: submission.id,
        actorId: req.auth!.userId,
        fromStatus: submission.status,
        toStatus: "GALLERY_ADDED",
        note: body.reason,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: "GALLERY_ENTRY_CREATED",
        targetType: "GalleryEntry",
        targetId: created.id,
        before: { submissionStatus: submission.status },
        after: {
          submissionStatus: "GALLERY_ADDED",
          publicationState: created.publicationState,
          tokenContract: created.tokenContract,
          tokenId: created.tokenId,
          feeShareBasisPoints: created.feeShare?.basisPoints,
        },
        reason: body.reason,
        requestId: req.id,
      },
    });
    return created;
  });
  res.status(201).json({ entry });
}));

const liftBody = z.object({ reason: z.string().trim().min(2).max(500) });
adminRouter.post("/restrictions/:id/lift", asyncRoute(async (req, res) => {
  const body = liftBody.parse(req.body);
  const restrictionId = req.params.id as string;
  const result = await db.$transaction(async (tx) => {
    const restriction = await tx.voteRestriction.findUnique({ where: { id: restrictionId } });
    if (!restriction) throw new ApiError(404, "RESTRICTION_NOT_FOUND", "That restriction was not found.");
    const updated = await tx.voteRestriction.update({
      where: { id: restriction.id },
      data: { liftedAt: new Date(), note: body.reason },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: "RESTRICTION_LIFTED",
        targetType: "VoteRestriction",
        targetId: restriction.id,
        before: { liftedAt: restriction.liftedAt, expiresAt: restriction.expiresAt },
        after: { liftedAt: updated.liftedAt },
        reason: body.reason,
        requestId: req.id,
      },
    });
    return updated;
  });
  res.json({ restriction: result });
}));
