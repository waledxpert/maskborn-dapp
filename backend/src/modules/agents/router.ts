import { Router, type Request } from "express";
import { encodeFunctionData, formatUnits, getAddress, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { config } from "../../config.js";
import { ApiError } from "../../errors.js";
import { requireWalletAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils.js";
import {
  arcClient,
  maskBornAddress,
  maskBornAccountV1Abi,
  maskBornAccountV2Abi,
  maskBornAgentRegistryAbi,
  maskBornAgentRegistryAddress,
  readAgentBinding,
  readAgentAccount,
  readCheckpointSession,
  readNativeUsdc,
  readOwnedTokenIds,
  readToken,
  readTokenURI,
} from "../chain/client.js";
import { buildConstitution, buildPersona } from "./persona.js";
import { collectionIndexStatus } from "../chain/collection-indexer.js";
import { db } from "../../db.js";
import { getAgentAction, listAgentActions, savePreparedAction, serializeAgentAction, submitAgentAction } from "./actions.js";
import { erc4337EntryPoint, readBundlerStatus } from "../chain/bundler.js";
import { readPaymasterStatus } from "../chain/paymaster.js";
import { getTokenSponsorshipBudget, readSponsorshipPolicy, reserveSponsorshipForAction } from "./sponsorship.js";
import { preflightCheckpointSponsorship } from "./checkpoint-preflight.js";
import { readCheckpointSubmitterStatus, submitCheckpointUserOperation } from "./checkpoint-submit.js";

export const agentsRouter = Router();
const tokenParams = z.object({ tokenId: z.coerce.bigint().refine((value) => value > 0n && value <= 10_000n) });
const actionParams = z.object({ actionId: z.string().cuid() });
const transactionBody = z.object({ txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });
const pauseBody = z.object({ paused: z.boolean() });
const uriBody = z.object({ agentURI: z.string().trim().min(1).max(2048).refine((value) => {
  try { return ["https:", "ipfs:", "data:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use an HTTPS, IPFS, or data URI.") });
const sendBody = z.object({
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
});
const sessionKeyParams = z.object({ sessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });
const grantSessionBody = z.object({
  sessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  durationHours: z.coerce.number().int().min(1).max(24),
  maxCalls: z.coerce.number().int().min(1).max(1_000),
});
const revokeSessionBody = z.object({ sessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });
const sponsorshipReserveBody = z.object({
  maxCostBaseUnits: z.string().regex(/^\d+$/).transform((value) => BigInt(value)).refine((value) => value > 0n),
  userOperationHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  userOperationNonce: z.string().regex(/^\d+$/).optional(),
});
const checkpointSponsorBody = z.object({
  sessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  category: z.enum(["monitor", "report", "liveness"]),
  payloadHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  waitForReceipt: z.boolean().default(false),
});

agentsRouter.get("/agents/status", asyncRoute(async (_req, res) => {
  const sponsorship = readSponsorshipPolicy();
  res.json({
    chainId: config.ARC_CHAIN_ID,
    network: config.ARC_CHAIN_ID === 5042002 ? "Arc Testnet" : "Arc",
    collectionAddress: maskBornAddress,
    configured: Boolean(maskBornAddress),
    phase: maskBornAgentRegistryAddress ? 2 : 1,
    awakening: maskBornAgentRegistryAddress ? "testnet" : "not_deployed",
    agentRegistryAddress: maskBornAgentRegistryAddress,
    accountAbstraction: {
      entryPoint: erc4337EntryPoint,
      accountPath: "checkpoint-only",
      directEntryPointSmoke: maskBornAgentRegistryAddress?.toLowerCase() === "0x7ce327dcd5148e2ea268595d804ca75b85c63326",
      bundlerProvider: config.AGENT_BUNDLER_PROVIDER,
      bundlerConfigured: config.AGENT_BUNDLER_PROVIDER !== "disabled" && Boolean(config.AGENT_BUNDLER_RPC_URL),
      paymasterProvider: config.AGENT_PAYMASTER_PROVIDER,
      sponsorship: sponsorship.enabled,
      sponsorshipReason: sponsorship.disabledReason,
      dailySponsorAllowance: sponsorship.dailyAllowance,
      dailySponsorTransactions: sponsorship.dailyTransactionLimit,
    },
  });
}));

agentsRouter.get("/agents/sponsorship/status", asyncRoute(async (_req, res) => {
  res.json(readSponsorshipPolicy());
}));

agentsRouter.get("/agents/tokens/:tokenId/sponsorship/budget", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const budget = await getTokenSponsorshipBudget(tokenId, actionAuth(req));
  res.json(budget);
}));
agentsRouter.post("/agents/tokens/:tokenId/sponsorship/checkpoint/preflight", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const body = checkpointSponsorBody.parse(req.body);
  const preflight = await preflightCheckpointSponsorship({
    tokenId,
    walletAddress: req.auth!.walletAddress!,
    auth: actionAuth(req),
    sessionKey: getAddress(body.sessionKey),
    categoryName: body.category,
    payloadHash: body.payloadHash.toLowerCase() as Hex,
  });
  res.json(preflight);
}));

agentsRouter.get("/agents/checkpoint-submitter/status", asyncRoute(async (_req, res) => {
  res.json(readCheckpointSubmitterStatus());
}));

agentsRouter.post("/agents/tokens/:tokenId/sponsorship/checkpoint/submit", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const body = checkpointSponsorBody.parse(req.body);
  const result = await submitCheckpointUserOperation({
    tokenId,
    walletAddress: req.auth!.walletAddress!,
    auth: actionAuth(req),
    sessionKey: getAddress(body.sessionKey),
    categoryName: body.category,
    payloadHash: body.payloadHash.toLowerCase() as Hex,
    waitForReceipt: body.waitForReceipt,
  });
  res.json(result);
}));

agentsRouter.post("/agents/actions/:actionId/sponsorship/reserve", requireWalletAuth, asyncRoute(async (req, res) => {
  const { actionId } = actionParams.parse(req.params);
  const body = sponsorshipReserveBody.parse(req.body);
  const reservation = await reserveSponsorshipForAction(actionId, actionAuth(req), body as { maxCostBaseUnits: bigint; userOperationHash?: Hex; userOperationNonce?: string });
  res.json(reservation);
}));

agentsRouter.get("/agents/paymaster/status", asyncRoute(async (_req, res) => {
  res.json(readPaymasterStatus());
}));

agentsRouter.get("/agents/bundler/status", asyncRoute(async (_req, res) => {
  const status = await readBundlerStatus().catch((error) => {
    throw new ApiError(503, "BUNDLER_UNAVAILABLE", (error as Error).message);
  });
  res.json(status);
}));

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
  const account = awakening?.configured && awakening.awakened
    ? await readAgentAccount(awakening.account).catch(() => null)
    : null;
  res.json({
    token: { tokenId: tokenId.toString(), owner: token.owner, revealed: token.revealed, collectionAddress: maskBornAddress, chainId: config.ARC_CHAIN_ID, asOfBlock: token.blockNumber.toString() },
    persona,
    wallet: wallet ? { nativeUsdc: formatUnits(wallet.balance, 18), nativeUsdcBaseUnits: wallet.balance.toString(), asOfBlock: wallet.blockNumber.toString() } : { unavailable: true },
    awakening: awakening?.configured ? {
      ...serializeBinding(awakening),
      accountState: account ? {
        nativeUsdc: formatUnits(account.balance, 18),
        nativeUsdcBaseUnits: account.balance.toString(),
        executionPaused: account.paused,
        state: account.state.toString(),
        checkpointSessions: account.checkpointSessions ? {
          supported: true,
          maxDurationSeconds: account.checkpointSessions.maxDurationSeconds.toString(),
          maxCalls: account.checkpointSessions.maxCalls.toString(),
        } : { supported: false },
        erc4337: account.erc4337 ? {
          supported: true,
          version: "0.9",
          entryPoint: account.erc4337.entryPoint,
          userOpNonce: account.erc4337.userOpNonce.toString(),
          executionScope: "checkpoint-only",
          sponsorship: false,
          bundlerProvider: config.AGENT_BUNDLER_PROVIDER,
          bundlerConfigured: config.AGENT_BUNDLER_PROVIDER !== "disabled",
          paymasterProvider: config.AGENT_PAYMASTER_PROVIDER,
        } : { supported: false },
        asOfBlock: account.blockNumber.toString(),
      } : null,
    } : { configured: false },
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

  const saved = await savePreparedAction(actionAuth(req), {
    tokenId,
    accountAddress: existing.account,
    type: "AWAKEN",
    targetAddress: maskBornAgentRegistryAddress,
    data,
    sourceBlock: existing.blockNumber,
    gasEstimate: gas,
    payload: { agentURI, constitutionHash: constitution.hash, predictedAccount: existing.account },
  });

  res.json({
    ...serializeAgentAction(saved.action, saved.gasEstimate),
    predictedAccount: existing.account,
    agentURI,
    constitutionHash: constitution.hash,
    simulationReturnedData: simulation.data ?? null,
  });
}));

agentsRouter.post("/agents/tokens/:tokenId/controls/pause/prepare", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const { paused } = pauseBody.parse(req.body);
  const { walletAddress, binding, account } = await requireAwakenedOwner(tokenId, req.auth!.walletAddress!);
  if (account.paused === paused) throw new ApiError(409, "PAUSE_STATE_UNCHANGED", `Agent execution is already ${paused ? "paused" : "active"}.`);
  const data = encodeFunctionData({ abi: maskBornAccountV1Abi, functionName: "setExecutionPaused", args: [paused] });
  const gas = await simulateOwnerAction(walletAddress, binding.account, data);
  const saved = await savePreparedAction(actionAuth(req), {
    tokenId, accountAddress: binding.account, type: "SET_EXECUTION_PAUSED", targetAddress: binding.account,
    data, sourceBlock: account.blockNumber, gasEstimate: gas, payload: { paused },
  });
  res.json(serializeAgentAction(saved.action, saved.gasEstimate));
}));

agentsRouter.post("/agents/tokens/:tokenId/controls/uri/prepare", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const { agentURI } = uriBody.parse(req.body);
  const { walletAddress, binding, account } = await requireAwakenedOwner(tokenId, req.auth!.walletAddress!);
  const data = encodeFunctionData({ abi: maskBornAccountV1Abi, functionName: "updateAgentURI", args: [agentURI] });
  const gas = await simulateOwnerAction(walletAddress, binding.account, data);
  const saved = await savePreparedAction(actionAuth(req), {
    tokenId, accountAddress: binding.account, type: "UPDATE_AGENT_URI", targetAddress: binding.account,
    data, sourceBlock: account.blockNumber, gasEstimate: gas, payload: { agentURI },
  });
  res.json(serializeAgentAction(saved.action, saved.gasEstimate));
}));

agentsRouter.post("/agents/tokens/:tokenId/controls/send/prepare", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const body = sendBody.parse(req.body);
  const recipient = getAddress(body.recipient);
  const amount = parseUnits(body.amount, 18);
  const maximum = parseUnits(config.AGENT_MAX_OWNER_SEND_USDC, 18);
  if (amount <= 0n) throw new ApiError(422, "INVALID_SEND_AMOUNT", "The USDC amount must be greater than zero.");
  if (amount > maximum) throw new ApiError(422, "OWNER_SEND_LIMIT", `This interface prepares at most ${config.AGENT_MAX_OWNER_SEND_USDC} USDC per action.`);
  const { walletAddress, binding, account } = await requireAwakenedOwner(tokenId, req.auth!.walletAddress!);
  const protectedAddresses = [zeroAddress, binding.account, binding.identityRegistry, maskBornAddress, maskBornAgentRegistryAddress].filter(Boolean).map((value) => value!.toLowerCase());
  if (protectedAddresses.includes(recipient.toLowerCase())) throw new ApiError(422, "PROTECTED_RECIPIENT", "That recipient is protected and cannot receive an owner-send action.");
  if (amount > account.balance) throw new ApiError(422, "INSUFFICIENT_AGENT_BALANCE", "The agent account does not have enough USDC for this transfer.");
  const data = encodeFunctionData({ abi: maskBornAccountV1Abi, functionName: "execute", args: [recipient, amount, "0x", 0] });
  const gas = await simulateOwnerAction(walletAddress, binding.account, data);
  const saved = await savePreparedAction(actionAuth(req), {
    tokenId, accountAddress: binding.account, type: "SEND_NATIVE_USDC", targetAddress: binding.account,
    data, sourceBlock: account.blockNumber, gasEstimate: gas, assetAmountBaseUnits: amount,
    payload: { recipient, amount: body.amount, asset: "native USDC", decimals: 18 },
  });
  res.json(serializeAgentAction(saved.action, saved.gasEstimate));
}));

agentsRouter.post("/agents/tokens/:tokenId/controls/sessions/grant/prepare", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const body = grantSessionBody.parse(req.body);
  const sessionKey = getAddress(body.sessionKey);
  const { walletAddress, binding, account } = await requireAwakenedOwner(tokenId, req.auth!.walletAddress!);
  if (!account.checkpointSessions) {
    throw new ApiError(409, "CHECKPOINT_SESSIONS_UNSUPPORTED", "This agent account predates checkpoint sessions and cannot grant one.");
  }
  const blocked = [walletAddress, binding.account, binding.identityRegistry, maskBornAddress, maskBornAgentRegistryAddress]
    .filter(Boolean).map((value) => value!.toLowerCase());
  if (blocked.includes(sessionKey.toLowerCase())) throw new ApiError(422, "INVALID_SESSION_KEY", "Choose a separate session-key address.");

  const block = await arcClient.getBlock({ blockNumber: account.blockNumber }).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The Arc block timestamp is temporarily unavailable.");
  });
  const validAfter = block.timestamp;
  const validUntil = validAfter + BigInt(body.durationHours * 60 * 60);
  const data = encodeFunctionData({
    abi: maskBornAccountV2Abi,
    functionName: "grantCheckpointSession",
    args: [sessionKey, validAfter, validUntil, body.maxCalls],
  });
  const gas = await simulateOwnerAction(walletAddress, binding.account, data);
  const saved = await savePreparedAction(actionAuth(req), {
    tokenId, accountAddress: binding.account, type: "GRANT_CHECKPOINT_SESSION", targetAddress: binding.account,
    data, sourceBlock: account.blockNumber, gasEstimate: gas,
    payload: {
      sessionKey,
      validAfter: validAfter.toString(),
      validUntil: validUntil.toString(),
      durationHours: body.durationHours,
      maxCalls: body.maxCalls,
      capability: "publish hashed checkpoints only",
    },
  });
  res.json(serializeAgentAction(saved.action, saved.gasEstimate));
}));

agentsRouter.post("/agents/tokens/:tokenId/controls/sessions/revoke/prepare", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const { sessionKey: rawSessionKey } = revokeSessionBody.parse(req.body);
  const sessionKey = getAddress(rawSessionKey);
  if (sessionKey === zeroAddress) throw new ApiError(422, "INVALID_SESSION_KEY", "Choose a nonzero session-key address.");
  const { walletAddress, binding, account } = await requireAwakenedOwner(tokenId, req.auth!.walletAddress!);
  if (!account.checkpointSessions) throw new ApiError(409, "CHECKPOINT_SESSIONS_UNSUPPORTED", "This agent account does not support checkpoint sessions.");
  const data = encodeFunctionData({ abi: maskBornAccountV2Abi, functionName: "revokeCheckpointSession", args: [sessionKey] });
  const gas = await simulateOwnerAction(walletAddress, binding.account, data);
  const saved = await savePreparedAction(actionAuth(req), {
    tokenId, accountAddress: binding.account, type: "REVOKE_CHECKPOINT_SESSION", targetAddress: binding.account,
    data, sourceBlock: account.blockNumber, gasEstimate: gas, payload: { sessionKey },
  });
  res.json(serializeAgentAction(saved.action, saved.gasEstimate));
}));

agentsRouter.get("/agents/tokens/:tokenId/controls/sessions/:sessionKey", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const { sessionKey: rawSessionKey } = sessionKeyParams.parse(req.params);
  const sessionKey = getAddress(rawSessionKey);
  const { binding, account } = await requireAwakenedOwner(tokenId, req.auth!.walletAddress!);
  if (!account.checkpointSessions) throw new ApiError(409, "CHECKPOINT_SESSIONS_UNSUPPORTED", "This agent account does not support checkpoint sessions.");
  const permission = await readCheckpointSession(binding.account, sessionKey).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The checkpoint session is temporarily unavailable.");
  });
  const now = permission.blockTimestamp;
  res.json({
    sessionKey,
    authorizedOwner: permission.authorizedOwner === zeroAddress ? null : permission.authorizedOwner,
    validAfter: permission.validAfter.toString(),
    validUntil: permission.validUntil.toString(),
    maxCalls: permission.maxCalls.toString(),
    calls: permission.calls.toString(),
    revoked: permission.revoked,
    active: !permission.revoked && permission.validAfter <= now && now < permission.validUntil
      && permission.authorizedOwner.toLowerCase() === req.auth!.walletAddress!.toLowerCase(),
    asOfBlock: permission.blockNumber.toString(),
  });
}));

agentsRouter.post("/agents/actions/:actionId/submitted", requireWalletAuth, asyncRoute(async (req, res) => {
  const { actionId } = actionParams.parse(req.params);
  const { txHash } = transactionBody.parse(req.body);
  const action = await submitAgentAction(actionId, txHash as Hex, actionAuth(req));
  res.json(serializeAgentAction(action));
}));

agentsRouter.get("/agents/actions/:actionId", requireWalletAuth, asyncRoute(async (req, res) => {
  const { actionId } = actionParams.parse(req.params);
  const action = await getAgentAction(actionId, actionAuth(req));
  res.json(serializeAgentAction(action));
}));

agentsRouter.get("/agents/tokens/:tokenId/actions", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  await requireCurrentTokenOwner(tokenId, req.auth!.walletAddress!);
  const actions = await listAgentActions(tokenId, actionAuth(req));
  res.json({ actions: actions.map((action) => serializeAgentAction(action)) });
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

agentsRouter.get("/agents/public/tokens/:tokenId/card", asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const token = await readToken(tokenId).catch(() => {
    throw new ApiError(404, "TOKEN_NOT_FOUND", "That Mask Born token was not found.");
  });
  if (!token.configured || !token.traits) throw new ApiError(404, "AGENT_NOT_AVAILABLE", "This Mask Born agent is not available.");
  const binding = await readAgentBinding(tokenId).catch(() => null);
  if (!binding?.configured || !binding.awakened) throw new ApiError(404, "AGENT_NOT_AWAKENED", "This Mask Born has not awakened.");
  const [account, metadata] = await Promise.all([
    readAgentAccount(binding.account).catch(() => null),
    readTokenURI(tokenId, token.blockNumber).catch(() => null),
  ]);
  const persona = buildPersona(tokenId, token.traits.map(Number));
  const publicOrigin = (config.AGENT_PUBLIC_ORIGIN ?? config.FRONTEND_URL).replace(/\/$/, "");
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  res.json({
    schema: "https://maskborn.art/schemas/agent-discovery-profile-v1",
    profileType: "maskborn-agent-discovery",
    name: persona.name,
    description: persona.summary,
    ...(metadata?.configured ? { image: imageFromTokenURI(metadata.tokenURI) } : {}),
    nft: { chainId: config.ARC_CHAIN_ID, collection: maskBornAddress, tokenId: tokenId.toString(), owner: token.owner },
    identity: { standard: "ERC-8004", registry: binding.identityRegistry, agentId: binding.agentId.toString() },
    account: {
      standard: "ERC-6551", address: binding.account, nativeCurrency: "USDC",
      balance: account ? formatUnits(account.balance, 18) : null,
      executionPaused: account?.paused ?? null,
      checkpointSessions: account?.checkpointSessions ? {
        supported: true,
        maxDurationSeconds: account.checkpointSessions.maxDurationSeconds.toString(),
        maxCalls: account.checkpointSessions.maxCalls.toString(),
        financialExecution: false,
        allowedCategories: ["monitor-observation", "report-digest", "liveness"],
      } : { supported: false },
      erc4337: account?.erc4337 ? {
        supported: true,
        version: "0.9",
        entryPoint: account.erc4337.entryPoint,
        userOpNonce: account.erc4337.userOpNonce.toString(),
        executionScope: "checkpoint-only",
        sponsorship: false,
          bundlerProvider: config.AGENT_BUNDLER_PROVIDER,
          bundlerConfigured: config.AGENT_BUNDLER_PROVIDER !== "disabled",
          paymasterProvider: config.AGENT_PAYMASTER_PROVIDER,
      } : { supported: false },
    },
    constitutionHash: binding.constitutionHash,
    endpoints: {
      registration: `${publicOrigin}/.well-known/agent-registration/maskborn/${tokenId}.json`,
      web: `${publicOrigin}/agents?tokenId=${tokenId}`,
    },
    protocols: { a2a: { enabled: false }, x402: { enabled: false } },
    capabilities: [
      { id: "public-persona", available: true },
      { id: "public-account-state", available: Boolean(account) },
      { id: "bounded-checkpoint-sessions", available: Boolean(account?.checkpointSessions) },
      { id: "erc4337-checkpoints", available: Boolean(account?.erc4337) },
      { id: "autonomous-execution", available: false },
    ],
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

async function requireAwakenedOwner(tokenId: bigint, expectedOwner: string) {
  const walletAddress = getAddress(expectedOwner);
  await requireCurrentTokenOwner(tokenId, walletAddress);
  const binding = await readAgentBinding(tokenId).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The awakening registry is temporarily unavailable.");
  });
  if (!binding.configured) throw new ApiError(503, "AWAKENING_NOT_DEPLOYED", "The awakening registry is not configured.");
  if (!binding.awakened) throw new ApiError(409, "AGENT_NOT_AWAKENED", "Awaken this Mask Born before using owner controls.");
  const account = await readAgentAccount(binding.account).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The agent account is temporarily unavailable.");
  });
  if (account.agentId !== binding.agentId || account.agentURIHash.toLowerCase() !== binding.agentURIHash.toLowerCase()) {
    throw new ApiError(503, "AGENT_BINDING_MISMATCH", "The agent registry and account identity do not agree. Owner actions are disabled.");
  }
  return { walletAddress, binding, account };
}

async function simulateOwnerAction(walletAddress: Address, target: Address, data: Hex) {
  return Promise.all([
    arcClient.call({ account: walletAddress, to: target, data }),
    arcClient.estimateGas({ account: walletAddress, to: target, data }),
  ]).then(([, gas]) => gas).catch(() => {
    throw new ApiError(422, "AGENT_ACTION_SIMULATION_FAILED", "Arc rejected this agent action simulation. No transaction was submitted.");
  });
}


function actionAuth(req: Request) {
  return {
    userId: req.auth!.userId,
    walletId: req.auth!.walletId!,
    walletAddress: req.auth!.walletAddress!,
  };
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

