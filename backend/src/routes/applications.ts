import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { ApiError } from "../errors.js";
import { requireVerifiedDiscord } from "../middleware/auth.js";
import { asyncRoute, extractXPostId } from "../utils.js";

export const applicationsRouter = Router();
const evm = /^0x[a-fA-F0-9]{40}$/;
const solana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const walletBody = z.object({ address: z.string().trim().min(20).max(80), primary: z.boolean().default(true) });
applicationsRouter.put("/wallet", requireVerifiedDiscord, asyncRoute(async (req, res) => {
  const body = walletBody.parse(req.body);
  const chain = evm.test(body.address) ? "EVM" : solana.test(body.address) ? "SOLANA" : null;
  if (!chain) throw new ApiError(422, "WALLET_INVALID", "Paste a valid EVM or Solana wallet address.");
  const normalized = chain === "EVM" ? body.address.toLowerCase() : body.address;
  const wallet = await db.$transaction(async (tx) => {
    if (body.primary) await tx.wallet.updateMany({ where: { userId: req.auth!.userId }, data: { isPrimary: false } });
    try {
      return await tx.wallet.upsert({
        where: { chain_normalized: { chain, normalized } },
        create: { userId: req.auth!.userId, chain, address: body.address, normalized, isPrimary: body.primary },
        update: { address: body.address, isPrimary: body.primary },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ApiError(409, "WALLET_ALREADY_CLAIMED", "That wallet is already attached to another profile.");
      }
      throw error;
    }
  });
  res.json({ wallet });
}));

const applicationBody = z.object({
  walletId: z.string().cuid(),
  quotePostUrl: z.string().url().refine((url) => extractXPostId(url) !== null, "Use a complete X post URL."),
  builderTraits: z.array(z.number().int().nonnegative()).length(8),
  previewAssetUrl: z.string().url().optional(),
  checklist: z.object({ liked: z.literal(true), reposted: z.literal(true), commented: z.literal(true) }),
});

applicationsRouter.post("/applications", requireVerifiedDiscord, asyncRoute(async (req, res) => {
  const body = applicationBody.parse(req.body);
  const previousApplication = await db.application.findUnique({ where: { userId: req.auth!.userId } });
  if (previousApplication) {
    throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "This profile has already submitted its application.");
  }
  const wallet = await db.wallet.findFirst({ where: { id: body.walletId, userId: req.auth!.userId } });
  if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "Choose a wallet from your profile.");
  const quotePostId = extractXPostId(body.quotePostUrl)!;
  const duplicate = await db.application.findUnique({ where: { quotePostId } });
  if (duplicate) throw new ApiError(409, "QUOTE_POST_ALREADY_USED", "That X quote post has already been submitted.");
  let application;
  try {
    application = await db.application.create({
      data: {
        userId: req.auth!.userId,
        walletId: wallet.id,
        quotePostUrl: body.quotePostUrl,
        quotePostId,
        builderTraits: body.builderTraits,
        previewAssetUrl: body.previewAssetUrl,
        likedState: "PENDING_MANUAL",
        repostedState: "PENDING_MANUAL",
        commentedState: "PENDING_MANUAL",
        quoteOwnershipState: "PENDING_MANUAL",
        status: "PENDING",
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const target = JSON.stringify((error as { meta?: { target?: unknown; constraint?: unknown } }).meta?.target
        ?? (error as { meta?: { constraint?: unknown } }).meta?.constraint
        ?? "");
      if (target.includes("quotePost")) {
        throw new ApiError(409, "QUOTE_POST_ALREADY_USED", "That X quote post has already been submitted.");
      }
      throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "This profile has already submitted its application.");
    }
    throw error;
  }
  res.status(201).json({
    application,
    message: "Application received. X activity is queued for manual review.",
  });
}));
