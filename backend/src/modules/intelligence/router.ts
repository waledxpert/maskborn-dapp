import { Router } from "express";
import { getAddress } from "viem";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import { requireWalletAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils.js";
import { maskBornAddress, readToken } from "../chain/client.js";
import { REPORT_CATALOG, createIntelligenceQuote, generateReport, getEntitlementByRequestKey, readIntelligenceStatus, serializeEntitlement } from "./service.js";

export const intelligenceRouter = Router();

const quoteBody = z.object({
  kind: z.enum(["COLLECTION_HEALTH", "WALLET_ACTIVITY", "USDC_STREAM_SUMMARY", "AGENT_PROFILE", "CHECKPOINT_SUMMARY"]),
  tokenId: z.coerce.bigint().refine((value) => value > 0n && value <= 10_000n),
});
const requestParams = z.object({ requestKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });

async function assertTokenOwner(tokenId: bigint, walletAddress: string) {
  const token = await readToken(tokenId).catch(() => { throw new ApiError(503, "ARC_READ_UNAVAILABLE", "Arc ownership is temporarily unavailable."); });
  if (!token.configured) throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The Mask Born collection is not configured.");
  if (getAddress(token.owner) !== getAddress(walletAddress)) throw new ApiError(403, "TOKEN_NOT_OWNED", "This wallet does not currently own that Mask Born.");
}

async function assertEntitlementOwner(requestKey: string, auth: { userId: string; walletId: string }) {
  const entitlement = await getEntitlementByRequestKey(requestKey);
  if (entitlement.userId !== auth.userId || entitlement.walletId !== auth.walletId) {
    throw new ApiError(403, "ENTITLEMENT_NOT_OWNED", "This report entitlement is not available to the connected wallet.");
  }
  if (entitlement.tokenId) await assertTokenOwner(BigInt(entitlement.tokenId), entitlement.walletAddress!);
  return entitlement;
}

intelligenceRouter.get("/intelligence/status", (_req, res) => {
  res.json(readIntelligenceStatus());
});

intelligenceRouter.get("/intelligence/catalog", (_req, res) => {
  res.json({ reports: REPORT_CATALOG, status: readIntelligenceStatus() });
});

intelligenceRouter.post("/intelligence/quote", requireWalletAuth, asyncRoute(async (req, res) => {
  const body = quoteBody.parse(req.body);
  await assertTokenOwner(body.tokenId, req.auth!.walletAddress!);
  const quote = await createIntelligenceQuote({
    kind: body.kind,
    tokenId: body.tokenId,
    walletAddress: req.auth!.walletAddress!,
    userId: req.auth!.userId,
    walletId: req.auth!.walletId!,
  });
  res.status(201).json(quote);
}));

intelligenceRouter.get("/intelligence/entitlements/:requestKey", requireWalletAuth, asyncRoute(async (req, res) => {
  const { requestKey } = requestParams.parse(req.params);
  const entitlement = await assertEntitlementOwner(requestKey, { userId: req.auth!.userId, walletId: req.auth!.walletId! });
  res.json(serializeEntitlement(entitlement));
}));

intelligenceRouter.post("/intelligence/reports/:requestKey/generate", requireWalletAuth, asyncRoute(async (req, res) => {
  const { requestKey } = requestParams.parse(req.params);
  await assertEntitlementOwner(requestKey, { userId: req.auth!.userId, walletId: req.auth!.walletId! });
  const report = await generateReport(requestKey);
  res.status(201).json(report);
}));

intelligenceRouter.get("/intelligence/reports/:requestKey", requireWalletAuth, asyncRoute(async (req, res) => {
  const { requestKey } = requestParams.parse(req.params);
  await assertEntitlementOwner(requestKey, { userId: req.auth!.userId, walletId: req.auth!.walletId! });
  const report = await generateReport(requestKey);
  res.json(report);
}));