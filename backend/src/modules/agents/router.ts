import { Router } from "express";
import { encodeFunctionData, formatUnits, getAddress } from "viem";
import { z } from "zod";
import { config } from "../../config.js";
import { ApiError } from "../../errors.js";
import { requireWalletAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils.js";
import {
  arcClient,
  maskBornAddress,
  maskBornAgentRegistryAbi,
  maskBornAgentRegistryAddress,
  readAgentBinding,
  readNativeUsdc,
  readOwnedTokenIds,
  readToken,
  readTokenURI,
} from "../chain/client.js";
import { buildConstitution, buildPersona } from "./persona.js";
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
    phase: maskBornAgentRegistryAddress ? 2 : 1,
    awakening: maskBornAgentRegistryAddress ? "testnet" : "not_deployed",
    agentRegistryAddress: maskBornAgentRegistryAddress,
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
  const awakening = await readAgentBinding(tokenId).catch(() => null);
  res.json({
    token: { tokenId: tokenId.toString(), owner: token.owner, revealed: token.revealed, collectionAddress: maskBornAddress, chainId: config.ARC_CHAIN_ID, asOfBlock: token.blockNumber.toString() },
    persona,
    wallet: wallet ? { nativeUsdc: formatUnits(wallet.balance, 18), nativeUsdcBaseUnits: wallet.balance.toString(), asOfBlock: wallet.blockNumber.toString() } : { unavailable: true },
    awakening: awakening?.configured ? serializeBinding(awakening) : { configured: false },
    capabilities: [
      { id: "traits", label: "Explain traits", status: persona ? "available" : "waiting_for_reveal" },
      { id: "wallet", label: "Read wallet balance", status: wallet ? "available" : "unavailable" },
      { id: "monitoring", label: "USDC monitoring", status: "coming_next" },
      { id: "payday", label: "Payday", status: "not_deployed" },
      { id: "awakening", label: "Onchain awakening", status: awakening?.configured ? (awakening.awakened ? "awakened" : "ready") : "not_deployed" },
    ],
  });
}));

agentsRouter.get("/agents/tokens/:tokenId/awakening", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  await requireCurrentTokenOwner(tokenId, req.auth!.walletAddress!);
  const binding = await readAgentBinding(tokenId).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The awakening registry is temporarily unavailable.");
  });
  res.json(binding.configured ? serializeBinding(binding) : { configured: false });
}));

agentsRouter.post("/agents/tokens/:tokenId/awakening/prepare", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  if (!maskBornAgentRegistryAddress) {
    throw new ApiError(503, "AWAKENING_NOT_DEPLOYED", "The Mask Born awakening contracts are not deployed yet.");
  }
  if (!config.AGENT_PUBLIC_ORIGIN) {
    throw new ApiError(503, "AGENT_ORIGIN_NOT_CONFIGURED", "A permanent public agent origin must be configured before awakening.");
  }

  const walletAddress = getAddress(req.auth!.walletAddress!);
  const token = await requireCurrentTokenOwner(tokenId, walletAddress);
  if (!token.revealed || !token.traits) {
    throw new ApiError(409, "TOKEN_NOT_REVEALED", "This Mask Born cannot awaken before its traits are revealed.");
  }
  const existing = await readAgentBinding(tokenId).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The awakening registry is temporarily unavailable.");
  });
  if (!existing.configured) throw new ApiError(503, "AWAKENING_NOT_DEPLOYED", "The awakening registry is not configured.");
  if (existing.awakened) throw new ApiError(409, "ALREADY_AWAKENED", "This Mask Born is already awakened.");

  const constitution = buildConstitution(tokenId, token.traits.map(Number));
  const publicOrigin = config.AGENT_PUBLIC_ORIGIN.replace(/\/$/, "");
  const agentURI = `${publicOrigin}/.well-known/agent-registration/maskborn/${tokenId}.json`;
  const data = encodeFunctionData({
    abi: maskBornAgentRegistryAbi,
    functionName: "awaken",
    args: [tokenId, agentURI, constitution.hash],
  });

  const [simulation, gas] = await Promise.all([
    arcClient.call({ account: walletAddress, to: maskBornAgentRegistryAddress, data }),
    arcClient.estimateGas({ account: walletAddress, to: maskBornAgentRegistryAddress, data }),
  ]).catch(() => {
    throw new ApiError(422, "AWAKENING_SIMULATION_FAILED", "Arc rejected the awakening simulation. No transaction was submitted.");
  });

  res.json({
    status: "prepared",
    chainId: config.ARC_CHAIN_ID,
    from: walletAddress,
    to: maskBornAgentRegistryAddress,
    data,
    value: "0x0",
    gasEstimate: gas.toString(),
    predictedAccount: existing.account,
    agentURI,
    constitutionHash: constitution.hash,
    simulationReturnedData: simulation.data ?? null,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}));

agentsRouter.get("/agents/public/tokens/:tokenId/registration", asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const token = await readToken(tokenId).catch(() => {
    throw new ApiError(404, "TOKEN_NOT_FOUND", "That Mask Born token was not found.");
  });
  if (!token.configured || !token.traits) {
    throw new ApiError(404, "AGENT_NOT_AVAILABLE", "This Mask Born agent is not available.");
  }
  const [binding, metadata] = await Promise.all([
    readAgentBinding(tokenId).catch(() => null),
    readTokenURI(tokenId, token.blockNumber).catch(() => null),
  ]);
  if (!binding?.configured || !binding.awakened) {
    throw new ApiError(404, "AGENT_NOT_AWAKENED", "This Mask Born has not awakened.");
  }

  const persona = buildPersona(tokenId, token.traits.map(Number));
  const publicOrigin = (config.AGENT_PUBLIC_ORIGIN ?? config.FRONTEND_URL).replace(/\/$/, "");
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: persona.name,
    description: persona.summary,
    ...(metadata?.configured ? { image: imageFromTokenURI(metadata.tokenURI) } : {}),
    services: [{ name: "web", endpoint: `${publicOrigin}/agents?tokenId=${tokenId}` }],
    x402Support: false,
    active: true,
    registrations: [{
      agentId: Number(binding.agentId),
      agentRegistry: `eip155:${config.ARC_CHAIN_ID}:${binding.identityRegistry}`,
    }],
  });
}));

async function requireCurrentTokenOwner(tokenId: bigint, expectedOwner: string) {
  const token = await readToken(tokenId).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "Arc data is temporarily unavailable.");
  });
  if (!token.configured) throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The canonical Mask Born deployment is not configured yet.");
  if (getAddress(token.owner) !== getAddress(expectedOwner)) {
    throw new ApiError(403, "TOKEN_NOT_OWNED", "This wallet does not currently own that Mask Born.");
  }
  return token;
}

function serializeBinding(binding: Awaited<ReturnType<typeof readAgentBinding>> & { configured: true }) {
  return {
    configured: true,
    awakened: binding.awakened,
    account: binding.account,
    agentId: binding.awakened ? binding.agentId.toString() : null,
    constitutionHash: binding.awakened ? binding.constitutionHash : null,
    agentURIHash: binding.awakened ? binding.agentURIHash : null,
    awakenedAtBlock: binding.awakened ? binding.awakenedAtBlock.toString() : null,
    asOfBlock: binding.blockNumber.toString(),
  };
}

function imageFromTokenURI(tokenURI: string) {
  const prefix = "data:application/json;base64,";
  if (!tokenURI.startsWith(prefix)) return undefined;
  try {
    const metadata = JSON.parse(Buffer.from(tokenURI.slice(prefix.length), "base64").toString("utf8")) as { image?: unknown };
    return typeof metadata.image === "string" ? metadata.image : undefined;
  } catch {
    return undefined;
  }
}
