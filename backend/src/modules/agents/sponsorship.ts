import { getAddress, parseUnits, type Hex } from "viem";
import type { AgentAction, SponsorshipReservation } from "../../generated/prisma/client.js";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import { currentOwnershipPeriod, type ActionAuth } from "./actions.js";
import { readPaymasterStatus } from "../chain/paymaster.js";

const ELIGIBLE_OPERATIONS = ["PUBLISH_CHECKPOINT"] as const;
const ELIGIBLE_ACTIONS = [] as const;
const EXCLUDED_ACTIONS = [
  "AWAKEN",
  "SET_EXECUTION_PAUSED",
  "UPDATE_AGENT_URI",
  "SEND_NATIVE_USDC",
  "GRANT_CHECKPOINT_SESSION",
  "REVOKE_CHECKPOINT_SESSION",
] as const;
const ACTIVE_BUDGET_STATUSES = ["RESERVED", "ATTACHED", "SETTLED", "FAILED"] as const;
const OPEN_RESERVATION_STATUSES = ["RESERVED", "ATTACHED"] as const;

type SponsorshipInput = {
  maxCostBaseUnits: bigint;
  userOperationHash?: Hex;
  userOperationNonce?: string;
};

function utcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function bigintFromDecimal(value: { toString(): string } | string | number | bigint | null | undefined) {
  if (value === null || value === undefined) return 0n;
  return BigInt(value.toString());
}

export function readSponsorshipPolicy() {
  const bundlerReady = config.AGENT_BUNDLER_PROVIDER !== "disabled" && Boolean(config.AGENT_BUNDLER_RPC_URL);
  const paymaster = readPaymasterStatus();
  const paymasterReady = paymaster.configured;
  const requested = config.AGENT_SPONSORSHIP_ENABLED === "true";
  const enabled = requested && bundlerReady && paymasterReady;
  const disabledReason = enabled ? null
    : !requested ? "SPONSORSHIP_NOT_ENABLED"
      : !bundlerReady ? "BUNDLER_NOT_CONFIGURED"
        : !paymasterReady ? "PAYMASTER_NOT_CONFIGURED"
          : "SPONSORSHIP_UNAVAILABLE";

  return {
    enabled,
    disabledReason,
    currency: "USDC",
    gasAsset: "native-USDC",
    dailyAllowance: config.AGENT_SPONSOR_DAILY_USDC_PER_TOKEN,
    dailyAllowanceBaseUnits: parseUnits(config.AGENT_SPONSOR_DAILY_USDC_PER_TOKEN, 18).toString(),
    dailyTransactionLimit: config.AGENT_SPONSOR_DAILY_TX_PER_TOKEN,
    reservationTtlSeconds: config.AGENT_SPONSOR_RESERVATION_TTL_SECONDS,
    eligibleActions: [...ELIGIBLE_ACTIONS],
    eligibleOperations: [...ELIGIBLE_OPERATIONS],
    excludedActions: [...EXCLUDED_ACTIONS],
    bundlerProvider: config.AGENT_BUNDLER_PROVIDER,
    paymasterProvider: config.AGENT_PAYMASTER_PROVIDER,
    paymasterConfigured: paymaster.configured,
    paymasterPolicyConfigured: paymaster.policyConfigured,
    accountingMode: "reservation-required",
    settlementMode: "receipt-reconciled",
    notes: [
      "The model never receives a spending key.",
      "Sponsored gas is limited to checkpoint-publishing UserOperations in the current V2 account.",
      "Owner-control actions still require the holder wallet until a future account version adds reviewed ERC-4337 control calls.",
      "A future reservation must bind chain, account, token, nonce, operation, and UserOperation hash before paymaster approval.",
    ],
  };
}

export async function expireStaleSponsorshipReservations(now = new Date()) {
  await db.sponsorshipReservation.updateMany({
    where: { status: { in: [...OPEN_RESERVATION_STATUSES] }, expiresAt: { lte: now } },
    data: { status: "EXPIRED", failureCode: "RESERVATION_EXPIRED" },
  });
}

export async function getTokenSponsorshipBudget(tokenId: bigint, auth: ActionAuth) {
  const policy = readSponsorshipPolicy();
  const ownershipPeriod = await currentOwnershipPeriod(tokenId, auth);
  await expireStaleSponsorshipReservations();
  const dailyBucket = utcDay();
  const reservations = await db.sponsorshipReservation.findMany({
    where: {
      chainId: config.ARC_CHAIN_ID,
      collectionAddress: ownershipPeriod.collectionAddress,
      tokenId: tokenId.toString(),
      dailyBucket,
      status: { in: [...ACTIVE_BUDGET_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const reservedBaseUnits = reservations.reduce((total, reservation) => {
    return total + bigintFromDecimal(reservation.actualCostBaseUnits ?? reservation.reservedCostBaseUnits);
  }, 0n);
  const allowanceBaseUnits = BigInt(policy.dailyAllowanceBaseUnits);
  const remainingBaseUnits = allowanceBaseUnits > reservedBaseUnits ? allowanceBaseUnits - reservedBaseUnits : 0n;
  const remainingTransactions = Math.max(policy.dailyTransactionLimit - reservations.length, 0);
  return {
    policy,
    tokenId: tokenId.toString(),
    ownershipPeriodId: ownershipPeriod.id,
    dailyBucket: dailyBucket.toISOString(),
    usedBaseUnits: reservedBaseUnits.toString(),
    remainingBaseUnits: remainingBaseUnits.toString(),
    usedTransactions: reservations.length,
    remainingTransactions,
    reservations: reservations.map((reservation) => serializeSponsorshipReservation(reservation)),
  };
}

export async function reserveSponsorshipForAction(actionId: string, auth: ActionAuth, input: SponsorshipInput) {
  const policy = readSponsorshipPolicy();
  if (input.maxCostBaseUnits <= 0n) throw new ApiError(400, "INVALID_SPONSORSHIP_COST", "Reservation cost must be greater than zero.");
  if (!input.userOperationHash) throw new ApiError(400, "USER_OPERATION_HASH_REQUIRED", "A sponsorship reservation must be bound to a UserOperation hash.");

  const action = await db.agentAction.findFirst({ where: { id: actionId, userId: auth.userId, walletId: auth.walletId } });
  if (!action) throw new ApiError(404, "ACTION_NOT_FOUND", "That agent action was not found.");
  if (!ELIGIBLE_ACTIONS.includes(action.type as never)) {
    throw new ApiError(422, "ACTION_NOT_SPONSORABLE", "This V2 sponsorship policy only covers checkpoint UserOperations, not owner-control actions.");
  }
  if (!policy.enabled) {
    throw new ApiError(409, policy.disabledReason ?? "SPONSORSHIP_DISABLED", "Sponsored gas is not enabled yet. The reservation policy is visible, but no paymaster approval is issued.");
  }
  if (!["PREPARED", "EXPIRED"].includes(action.status)) {
    throw new ApiError(409, "ACTION_NOT_SPONSORABLE", "Only reviewed, unsubmitted actions can reserve sponsored gas.");
  }
  if (action.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(409, "ACTION_EXPIRED", "Prepare the action again before reserving sponsored gas.");
  }

  await expireStaleSponsorshipReservations();
  const tokenId = BigInt(action.tokenId);
  const budget = await getTokenSponsorshipBudget(tokenId, auth);
  if (budget.remainingTransactions <= 0) throw new ApiError(429, "SPONSOR_TX_LIMIT", "This token has used its sponsored transaction allowance for today.");
  if (BigInt(budget.remainingBaseUnits) < input.maxCostBaseUnits) throw new ApiError(429, "SPONSOR_BUDGET_EXCEEDED", "This token does not have enough sponsored gas allowance remaining today.");

  const expiresAt = new Date(Date.now() + policy.reservationTtlSeconds * 1_000);
  const dailyBucket = utcDay();
  const reservationKey = `${config.ARC_CHAIN_ID}:${action.collectionAddress}:${action.tokenId}:${action.id}`;
  const reservation = await db.sponsorshipReservation.upsert({
    where: { reservationKey },
    create: {
      userId: auth.userId,
      walletId: auth.walletId,
      ownershipPeriodId: action.ownershipPeriodId,
      agentActionId: action.id,
      chainId: action.chainId,
      collectionAddress: action.collectionAddress,
      tokenId: action.tokenId,
      accountAddress: action.accountAddress,
      actionType: action.type,
      status: "RESERVED",
      dailyBucket,
      dailyAllowanceBaseUnits: policy.dailyAllowanceBaseUnits,
      dailyTransactionLimit: policy.dailyTransactionLimit,
      reservedCostBaseUnits: input.maxCostBaseUnits.toString(),
      reservationKey,
      userOperationHash: input.userOperationHash.toLowerCase(),
      userOperationNonce: input.userOperationNonce ?? null,
      expiresAt,
    },
    update: {
      status: "RESERVED",
      reservedCostBaseUnits: input.maxCostBaseUnits.toString(),
      userOperationHash: input.userOperationHash.toLowerCase(),
      userOperationNonce: input.userOperationNonce ?? null,
      expiresAt,
      failureCode: null,
    },
  });
  return serializeSponsorshipReservation(reservation, action);
}

export function serializeSponsorshipReservation(reservation: SponsorshipReservation, action?: AgentAction) {
  return {
    id: reservation.id,
    status: reservation.status.toLowerCase(),
    chainId: reservation.chainId,
    tokenId: reservation.tokenId,
    account: getAddress(reservation.accountAddress),
    actionId: reservation.agentActionId,
    actionType: reservation.actionType,
    userOperationHash: reservation.userOperationHash,
    userOperationNonce: reservation.userOperationNonce,
    txHash: reservation.txHash,
    currency: reservation.currency,
    gasAsset: reservation.gasAsset,
    dailyBucket: reservation.dailyBucket.toISOString(),
    dailyAllowanceBaseUnits: reservation.dailyAllowanceBaseUnits.toString(),
    reservedCostBaseUnits: reservation.reservedCostBaseUnits.toString(),
    actualCostBaseUnits: reservation.actualCostBaseUnits?.toString() ?? null,
    expiresAt: reservation.expiresAt.toISOString(),
    settledAt: reservation.settledAt?.toISOString() ?? null,
    failureCode: reservation.failureCode,
    actionStatus: action?.status.toLowerCase() ?? null,
    createdAt: reservation.createdAt.toISOString(),
  };
}