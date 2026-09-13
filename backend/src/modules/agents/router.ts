import { Router } from "express";
import { formatUnits, getAddress } from "viem";
import { z } from "zod";
import { config } from "../../config.js";
import { ApiError } from "../../errors.js";
import { requireWalletAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils.js";
import { maskBornAddress, readNativeUsdc, readOwnedTokenIds, readToken } from "../chain/client.js";
import { buildPersona } from "./persona.js";
import { collectionIndexStatus } from "../chain/collection-indexer.js";
import { db } from "../../db.js";

export const agentsRouter = Router();
const tokenParams = z.object({ tokenId: z.coerce.bigint().refine((value) => value > 0n && value <= 10_000n) });

agentsRouter.get("/agents/status", (_req, res) => {
  res.json({
    chainId: config.ARC_CHAIN_ID,
    network: config.ARC_CHAIN_ID === 5042002 ? "Arc Testnet" : "Arc",
    collectionAddress: maskBornAddress,
    configured: Boolean(maskBornAddress),
    phase: 1,
    awakening: "preview",
  });
});

agentsRouter.get("/agents/index/status", asyncRoute(async (_req, res) => {
  const status = await collectionIndexStatus().catch(() => {
    throw new ApiError(503, "ARC_INDEX_UNAVAILABLE", "The ownership index status is temporarily unavailable.");
  });
  res.json(status.configured ? {
    ...status,
    latestBlock: status.latestBlock.toString(),
    nextBlock: status.nextBlock?.toString() ?? null,
    indexedThrough: status.indexedThrough?.toString() ?? null,
  } : status);
}));

agentsRouter.get("/agents/owned", requireWalletAuth, asyncRoute(async (req, res) => {
  const walletAddress = getAddress(req.auth!.walletAddress!);
  const result = await readOwnedTokenIds(walletAddress).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "Owned Mask Born tokens are temporarily unavailable.");
  });
  if (!result.configured) {
    throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The canonical Mask Born deployment is not configured yet.");
  }
  const periods = await db.ownershipPeriod.findMany({
    where: {
      chainId: config.ARC_CHAIN_ID,
      collectionAddress: maskBornAddress!.toLowerCase(),
      tokenId: { in: result.tokenIds.map(String) },
      ownerAddress: walletAddress.toLowerCase(),
      endedBlock: null,
    },
    select: { id: true, tokenId: true, sequence: true, startedBlock: true },
  });
  const periodByToken = new Map(periods.map((period) => [period.tokenId, period]));
  res.json({
    owner: walletAddress,
    tokenIds: result.tokenIds.map(String),
    tokens: result.tokenIds.map(String).map((id) => {
      const period = periodByToken.get(id);
      return { tokenId: id, ownershipPeriodId: period?.id ?? null, ownershipSequence: period?.sequence ?? null, ownedSinceBlock: period?.startedBlock.toString() ?? null };
    }),
    chainId: config.ARC_CHAIN_ID,
    collectionAddress: maskBornAddress,
    asOfBlock: result.blockNumber.toString(),
  });
}));

agentsRouter.get("/agents/tokens/:tokenId/preview", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const token = await readToken(tokenId).catch(() => { throw new ApiError(503, "ARC_READ_UNAVAILABLE", "Arc data is temporarily unavailable."); });
  if (!token.configured) throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The canonical Mask Born deployment is not configured yet.");
  if (getAddress(token.owner) !== getAddress(req.auth!.walletAddress!)) {
    throw new ApiError(403, "TOKEN_NOT_OWNED", "This wallet does not currently own that Mask Born.");
  }
  const wallet = await readNativeUsdc(getAddress(req.auth!.walletAddress!)).catch(() => null);
  const persona = token.traits ? buildPersona(tokenId, token.traits.map(Number)) : null;
  res.json({
    token: { tokenId: tokenId.toString(), owner: token.owner, revealed: token.revealed, collectionAddress: maskBornAddress, chainId: config.ARC_CHAIN_ID, asOfBlock: token.blockNumber.toString() },
    persona,
    wallet: wallet ? { nativeUsdc: formatUnits(wallet.balance, 18), nativeUsdcBaseUnits: wallet.balance.toString(), asOfBlock: wallet.blockNumber.toString() } : { unavailable: true },
    capabilities: [
      { id: "traits", label: "Explain traits", status: persona ? "available" : "waiting_for_reveal" },
      { id: "wallet", label: "Read wallet balance", status: wallet ? "available" : "unavailable" },
      { id: "monitoring", label: "USDC monitoring", status: "coming_next" },
      { id: "payday", label: "Payday", status: "not_deployed" },
      { id: "awakening", label: "Onchain awakening", status: "phase_2" },
    ],
  });
}));
