import type { AgentAction } from "../../generated/prisma/client.js";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import { arcClient, maskBornAddress } from "../chain/client.js";

const ACTION_LIFETIME_MS = 5 * 60_000;
const UNKNOWN_AFTER_MS = 15 * 60_000;

export type PreparedAgentAction = {
  tokenId: bigint;
  accountAddress: Address;
  type: "AWAKEN" | "SET_EXECUTION_PAUSED" | "UPDATE_AGENT_URI" | "SEND_NATIVE_USDC" | "GRANT_CHECKPOINT_SESSION" | "REVOKE_CHECKPOINT_SESSION";
  targetAddress: Address;
  data: Hex;
  sourceBlock: bigint;
  gasEstimate: bigint;
  transactionValueBaseUnits?: bigint;
  assetAmountBaseUnits?: bigint;
  payload: Record<string, string | number | boolean | null>;
};

type ActionAuth = { userId: string; walletId: string; walletAddress: string };

export async function currentOwnershipPeriod(tokenId: bigint, auth: ActionAuth) {
  if (!maskBornAddress) {
    throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The canonical Mask Born deployment is not configured yet.");
  }
  const period = await db.ownershipPeriod.findFirst({
    where: {
      chainId: config.ARC_CHAIN_ID,
      collectionAddress: maskBornAddress.toLowerCase(),
      tokenId: tokenId.toString(),
      ownerAddress: getAddress(auth.walletAddress).toLowerCase(),
      endedBlock: null,
    },
    orderBy: { sequence: "desc" },
  });
  if (!period) {
    throw new ApiError(409, "OWNERSHIP_INDEX_NOT_READY", "The ownership index must catch up before this agent action can be prepared.");
  }
  if (period.walletId && period.walletId !== auth.walletId) {
    throw new ApiError(409, "OWNERSHIP_SESSION_MISMATCH", "Sign in again with the wallet that owns this Mask Born.");
  }
  if (!period.walletId) {
    return db.ownershipPeriod.update({ where: { id: period.id }, data: { walletId: auth.walletId } });
  }
  return period;
}

export async function savePreparedAction(auth: ActionAuth, action: PreparedAgentAction) {
  const ownershipPeriod = await currentOwnershipPeriod(action.tokenId, auth);
  const expiresAt = new Date(Date.now() + ACTION_LIFETIME_MS);
  const saved = await db.agentAction.create({
    data: {
      userId: auth.userId,
      walletId: auth.walletId,
      ownershipPeriodId: ownershipPeriod.id,
      chainId: config.ARC_CHAIN_ID,
      collectionAddress: maskBornAddress!.toLowerCase(),
      tokenId: action.tokenId.toString(),
      accountAddress: action.accountAddress.toLowerCase(),
      type: action.type,
      senderAddress: getAddress(auth.walletAddress).toLowerCase(),
      targetAddress: action.targetAddress.toLowerCase(),
      transactionValueBaseUnits: (action.transactionValueBaseUnits ?? 0n).toString(),
      assetAmountBaseUnits: action.assetAmountBaseUnits?.toString(),
      callData: action.data.toLowerCase(),
      calldataHash: keccak256(action.data),
      payload: action.payload,
      sourceBlock: action.sourceBlock,
      expiresAt,
    },
  });
  return { action: saved, gasEstimate: action.gasEstimate };
}

export async function submitAgentAction(actionId: string, txHash: Hex, auth: ActionAuth) {
  let action = await ownedAction(actionId, auth);
  if (action.txHash && action.txHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new ApiError(409, "ACTION_ALREADY_SUBMITTED", "This prepared action already has a different transaction.");
  }
  if (!action.txHash && !["PREPARED", "EXPIRED"].includes(action.status)) {
    throw new ApiError(409, "ACTION_NOT_SUBMITTABLE", "This agent action can no longer accept a transaction.");
  }

  const transaction = await arcClient.getTransaction({ hash: txHash }).catch(() => null);
  if (transaction && !transactionMatches(action, transaction)) {
    throw new ApiError(422, "TRANSACTION_MISMATCH", "The wallet transaction does not match the reviewed agent action.");
  }

  if (!action.txHash) {
    try {
      const claimed = await db.agentAction.updateMany({
        where: { id: action.id, txHash: null, status: { in: ["PREPARED", "EXPIRED"] } },
        data: { txHash: txHash.toLowerCase(), status: "SUBMITTED", submittedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const concurrent = await ownedAction(action.id, auth);
        if (concurrent.txHash?.toLowerCase() !== txHash.toLowerCase()) {
          throw new ApiError(409, "ACTION_ALREADY_SUBMITTED", "This prepared action already has a different transaction.");
        }
        action = concurrent;
      } else {
        action = await ownedAction(action.id, auth);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, "TRANSACTION_ALREADY_TRACKED", "That transaction is already attached to another action.");
    }
  }
  return reconcileAgentAction(action);
}

export async function getAgentAction(actionId: string, auth: ActionAuth) {
  return reconcileAgentAction(await ownedAction(actionId, auth));
}

export async function listAgentActions(tokenId: bigint, auth: ActionAuth) {
  const period = await currentOwnershipPeriod(tokenId, auth);
  const actions = await db.agentAction.findMany({
    where: { userId: auth.userId, walletId: auth.walletId, ownershipPeriodId: period.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return Promise.all(actions.map(reconcileAgentAction));
}

async function ownedAction(actionId: string, auth: ActionAuth) {
  const action = await db.agentAction.findFirst({
    where: { id: actionId, userId: auth.userId, walletId: auth.walletId },
  });
  if (!action) throw new ApiError(404, "ACTION_NOT_FOUND", "That agent action was not found.");
  return action;
}

async function reconcileAgentAction(action: AgentAction): Promise<AgentAction> {
  if (action.status === "PREPARED" && action.expiresAt.getTime() <= Date.now()) {
    return db.agentAction.update({ where: { id: action.id }, data: { status: "EXPIRED" } });
  }
  if (!action.txHash || !["SUBMITTED", "UNKNOWN"].includes(action.status)) return action;

  const hash = action.txHash as Hex;
  const [transaction, receipt] = await Promise.all([
    arcClient.getTransaction({ hash }).catch(() => null),
    arcClient.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!transaction || !receipt) {
    if (action.submittedAt && Date.now() - action.submittedAt.getTime() >= UNKNOWN_AFTER_MS && action.status !== "UNKNOWN") {
      return db.agentAction.update({ where: { id: action.id }, data: { status: "UNKNOWN", failureCode: "RECEIPT_NOT_FOUND" } });
    }
    return action;
  }
  if (!transactionMatches(action, transaction)) {
    return db.agentAction.update({ where: { id: action.id }, data: { status: "FAILED", failureCode: "TRANSACTION_MISMATCH" } });
  }
  const succeeded = receipt.status === "success";
  return db.agentAction.update({
    where: { id: action.id },
    data: {
      status: succeeded ? "CONFIRMED" : "FAILED",
      receiptBlock: receipt.blockNumber,
      receiptBlockHash: receipt.blockHash.toLowerCase(),
      failureCode: succeeded ? null : "TRANSACTION_REVERTED",
      confirmedAt: succeeded ? new Date() : null,
    },
  });
}

export function transactionMatches(action: AgentAction, transaction: { from: Address; to: Address | null; input: Hex; value: bigint }) {
  return (
    transaction.from.toLowerCase() === action.senderAddress &&
    transaction.to?.toLowerCase() === action.targetAddress &&
    transaction.input.toLowerCase() === action.callData &&
    transaction.value.toString() === action.transactionValueBaseUnits.toString()
  );
}

export function serializeAgentAction(action: AgentAction, gasEstimate?: bigint) {
  return {
    id: action.id,
    status: action.status.toLowerCase(),
    type: action.type,
    chainId: action.chainId,
    tokenId: action.tokenId,
    account: getAddress(action.accountAddress),
    from: getAddress(action.senderAddress),
    to: getAddress(action.targetAddress),
    data: action.callData,
    calldataHash: action.calldataHash,
    value: `0x${BigInt(action.transactionValueBaseUnits.toString()).toString(16)}`,
    assetAmountBaseUnits: action.assetAmountBaseUnits?.toString() ?? null,
    payload: action.payload,
    gasEstimate: gasEstimate?.toString() ?? null,
    sourceBlock: action.sourceBlock.toString(),
    expiresAt: action.expiresAt.toISOString(),
    txHash: action.txHash,
    failureCode: action.failureCode,
    createdAt: action.createdAt.toISOString(),
    submittedAt: action.submittedAt?.toISOString() ?? null,
    confirmedAt: action.confirmedAt?.toISOString() ?? null,
  };
}
