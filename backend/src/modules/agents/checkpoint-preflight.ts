import { encodeFunctionData, getAddress, keccak256, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import { ApiError } from "../../errors.js";
import { erc4337EntryPoint } from "../chain/bundler.js";
import { maskBornAccountV2Abi, readAgentAccount, readAgentBinding, readCheckpointSession, readToken } from "../chain/client.js";
import { getTokenSponsorshipBudget } from "./sponsorship.js";
import type { ActionAuth } from "./actions.js";

export type CheckpointCategoryName = "monitor" | "report" | "liveness";

export function checkpointCategory(category: CheckpointCategoryName) {
  switch (category) {
    case "monitor": return keccak256(stringToHex("MASKBORN_MONITOR_OBSERVATION_V1"));
    case "report": return keccak256(stringToHex("MASKBORN_REPORT_DIGEST_V1"));
    case "liveness": return keccak256(stringToHex("MASKBORN_LIVENESS_V1"));
  }
}

export async function preflightCheckpointSponsorship(input: {
  tokenId: bigint;
  walletAddress: string;
  auth: ActionAuth;
  sessionKey: Address;
  categoryName: CheckpointCategoryName;
  payloadHash: Hex;
}) {
  const walletAddress = getAddress(input.walletAddress);
  const payloadHash = input.payloadHash.toLowerCase() as Hex;
  if (/^0x0{64}$/.test(payloadHash)) throw new ApiError(422, "INVALID_CHECKPOINT", "Checkpoint payload hash cannot be zero.");

  const token = await readToken(input.tokenId).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "Arc ownership is temporarily unavailable.");
  });
  if (!token.configured) throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The Mask Born collection is not configured.");
  if (getAddress(token.owner) !== walletAddress) throw new ApiError(403, "TOKEN_NOT_OWNED", "This wallet does not currently own that Mask Born.");

  const binding = await readAgentBinding(input.tokenId).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The awakening registry is temporarily unavailable.");
  });
  if (!binding.configured) throw new ApiError(503, "AWAKENING_NOT_DEPLOYED", "The awakening registry is not configured.");
  if (!binding.awakened) throw new ApiError(409, "AGENT_NOT_AWAKENED", "Awaken this Mask Born before requesting checkpoint sponsorship.");

  const account = await readAgentAccount(binding.account).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The agent account is temporarily unavailable.");
  });
  if (account.agentId !== binding.agentId || account.agentURIHash.toLowerCase() !== binding.agentURIHash.toLowerCase()) {
    throw new ApiError(503, "AGENT_BINDING_MISMATCH", "The agent registry and account identity do not agree. Checkpoint sponsorship is disabled.");
  }
  if (!account.checkpointSessions || !account.erc4337) throw new ApiError(409, "ERC4337_CHECKPOINTS_UNSUPPORTED", "This agent account does not support checkpoint UserOperations.");
  if (account.erc4337.entryPoint.toLowerCase() !== erc4337EntryPoint.toLowerCase()) {
    throw new ApiError(409, "ENTRYPOINT_MISMATCH", "This account is not bound to the configured EntryPoint.");
  }

  const sessionKey = getAddress(input.sessionKey);
  if (sessionKey === zeroAddress) throw new ApiError(422, "INVALID_SESSION_KEY", "Choose a nonzero checkpoint session key.");
  const permission = await readCheckpointSession(binding.account, sessionKey).catch(() => {
    throw new ApiError(503, "ARC_READ_UNAVAILABLE", "The checkpoint session is temporarily unavailable.");
  });
  const active = !permission.revoked && permission.validAfter <= permission.blockTimestamp
    && permission.blockTimestamp < permission.validUntil
    && permission.calls < permission.maxCalls
    && permission.authorizedOwner.toLowerCase() === walletAddress.toLowerCase();
  if (!active) throw new ApiError(409, "CHECKPOINT_SESSION_INACTIVE", "Grant or refresh this checkpoint session before requesting sponsored checkpoint gas.");

  const category = checkpointCategory(input.categoryName);
  const callData = encodeFunctionData({
    abi: maskBornAccountV2Abi,
    functionName: "executeCheckpointUserOp",
    args: [sessionKey, category, payloadHash],
  });
  const budget = await getTokenSponsorshipBudget(input.tokenId, input.auth);
  const blockers = [
    budget.policy.enabled ? null : budget.policy.disabledReason ?? "SPONSORSHIP_DISABLED",
    budget.remainingTransactions > 0 ? null : "SPONSOR_TX_LIMIT",
    BigInt(budget.remainingBaseUnits) > 0n ? null : "SPONSOR_BUDGET_EXHAUSTED",
  ].filter((value): value is string => Boolean(value));

  return {
    operation: "PUBLISH_CHECKPOINT" as const,
    sponsorable: true,
    canSponsor: blockers.length === 0,
    blockers,
    account: binding.account,
    entryPoint: erc4337EntryPoint,
    nonce: account.erc4337.userOpNonce.toString(),
    callData,
    category,
    categoryName: input.categoryName,
    payloadHash,
    session: {
      sessionKey,
      validUntil: permission.validUntil.toString(),
      calls: permission.calls.toString(),
      maxCalls: permission.maxCalls.toString(),
    },
    budget: {
      dailyAllowanceBaseUnits: budget.policy.dailyAllowanceBaseUnits,
      remainingBaseUnits: budget.remainingBaseUnits,
      remainingTransactions: budget.remainingTransactions,
    },
  };
}