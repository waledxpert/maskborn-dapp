import { formatUnits, getAddress, keccak256, stringToHex, type Address } from "viem";
import type { MonitorRule } from "../../generated/prisma/client.js";
import { db } from "../../db.js";
import { arcClient, arcUsdcAddress, readToken, transferEvent } from "../chain/client.js";
import { acceptsPayment, directionFor, nextOccurrence, previousOccurrence, type PaymentDirection } from "./monitor-domain.js";
import { preflightCheckpointSponsorship } from "../agents/checkpoint-preflight.js";

const BLOCK_BATCH = 2_000n;

async function logsFor(rule: MonitorRule, fromBlock: bigint, toBlock: bigint) {
  const address = getAddress(rule.watchedAddress);
  const incoming = rule.direction !== "OUTGOING"
    ? await arcClient.getLogs({ address: arcUsdcAddress, event: transferEvent, args: { to: address }, fromBlock, toBlock, strict: true })
    : [];
  const outgoing = rule.direction !== "INCOMING"
    ? await arcClient.getLogs({ address: arcUsdcAddress, event: transferEvent, args: { from: address }, fromBlock, toBlock, strict: true })
    : [];
  return [...incoming, ...outgoing].sort((left, right) => {
    const blockDifference = Number(left.blockNumber - right.blockNumber);
    return blockDifference || Number(left.logIndex - right.logIndex);
  });
}

async function recordPayment(rule: MonitorRule, log: Awaited<ReturnType<typeof logsFor>>[number]) {
  const fromAddress = getAddress(log.args.from);
  const toAddress = getAddress(log.args.to);
  const actualDirection = directionFor(rule.watchedAddress, fromAddress, toAddress);
  if (!actualDirection || !acceptsPayment({
    configuredDirection: rule.direction,
    actualDirection,
    counterparty: rule.counterparty,
    fromAddress,
    toAddress,
    amount: log.args.value,
    minimumAmount: BigInt(rule.minimumAmount.toString()),
  })) return false;

  const block = await arcClient.getBlock({ blockNumber: log.blockNumber });
  const blockTime = new Date(Number(block.timestamp) * 1_000);
  const txHash = log.transactionHash.toLowerCase();
  const directionLabel = actualDirection === "INCOMING" ? "received" : "sent";
  const amount = formatUnits(log.args.value, 6);

  await db.$transaction(async (transaction) => {
    const payment = await transaction.observedPayment.upsert({
      where: { chainId_txHash_logIndex: { chainId: rule.chainId, txHash, logIndex: log.logIndex } },
      create: {
        chainId: rule.chainId,
        txHash,
        logIndex: log.logIndex,
        fromAddress,
        toAddress,
        amount: log.args.value.toString(),
        blockNumber: log.blockNumber,
        blockTime,
      },
      update: {},
    });
    await transaction.monitorMatch.upsert({
      where: { monitorRuleId_observedPaymentId: { monitorRuleId: rule.id, observedPaymentId: payment.id } },
      create: { monitorRuleId: rule.id, observedPaymentId: payment.id, direction: actualDirection },
      update: {},
    });
    const deliveryKey = `payment:${rule.id}:${rule.chainId}:${txHash}:${log.logIndex}`;
    await transaction.agentNotification.upsert({
      where: { deliveryKey },
      create: {
        userId: rule.userId,
        monitorRuleId: rule.id,
        observedPaymentId: payment.id,
        type: actualDirection === "INCOMING" ? "PAYMENT_RECEIVED" : "PAYMENT_SENT",
        title: `${amount} USDC ${directionLabel}`,
        body: actualDirection === "INCOMING" ? `Payment received from ${fromAddress}.` : `Payment sent to ${toAddress}.`,
        deliveryKey,
        data: { txHash, blockNumber: log.blockNumber.toString(), amountBaseUnits: log.args.value.toString(), decimals: 6, direction: actualDirection },
      },
      update: {},
    });
  });
  return true;
}

async function evaluateLateWindows(rule: MonitorRule, now: Date) {
  if (rule.cadence === "CONTINUOUS" || !rule.nextExpectedAt || !rule.expectedAmount) return;
  let due = rule.nextExpectedAt;
  let evaluated = 0;
  while (evaluated < 14 && now.getTime() > due.getTime() + rule.graceMinutes * 60_000) {
    const windowStart = previousOccurrence(due, rule.cadence);
    const deadline = new Date(due.getTime() + rule.graceMinutes * 60_000);
    const received = await db.monitorMatch.findFirst({
      where: {
        monitorRuleId: rule.id,
        direction: "INCOMING",
        observedPayment: {
          amount: { gte: rule.expectedAmount },
          blockTime: { gt: windowStart, lte: deadline },
        },
      },
      select: { observedPaymentId: true },
    });
    if (!received) {
      const expected = formatUnits(BigInt(rule.expectedAmount.toString()), 6);
      const deliveryKey = `late:${rule.id}:${due.toISOString()}`;
      await db.agentNotification.upsert({
        where: { deliveryKey },
        create: {
          userId: rule.userId,
          monitorRuleId: rule.id,
          type: "PAYMENT_LATE",
          title: `Expected ${expected} USDC is late`,
          body: `No matching incoming payment was found by ${deadline.toISOString()}.`,
          deliveryKey,
          data: { dueAt: due.toISOString(), graceMinutes: rule.graceMinutes, expectedAmountBaseUnits: rule.expectedAmount.toString(), decimals: 6 },
        },
        update: {},
      });
    }
    due = nextOccurrence(due, rule.cadence);
    evaluated += 1;
  }
  if (due.getTime() !== rule.nextExpectedAt.getTime()) {
    await db.monitorRule.update({ where: { id: rule.id }, data: { nextExpectedAt: due } });
  }
}

async function preflightMonitorCheckpoint(rule: MonitorRule, payments: number, throughBlock: bigint) {
  if (!rule.checkpointOnMatch || !rule.checkpointSessionKey || payments <= 0) return;
  const payload = {
    kind: "MASKBORN_MONITOR_OBSERVATION_V1",
    ruleId: rule.id,
    tokenId: rule.tokenId,
    chainId: rule.chainId,
    throughBlock: throughBlock.toString(),
    payments,
  };
  const payloadHash = keccak256(stringToHex(JSON.stringify(payload)));
  const deliveryKey = `checkpoint-preflight:${rule.id}:${throughBlock.toString()}:${payloadHash}`;
  try {
    const preflight = await preflightCheckpointSponsorship({
      tokenId: BigInt(rule.tokenId),
      walletAddress: rule.watchedAddress,
      auth: { userId: rule.userId, walletId: rule.walletId, walletAddress: rule.watchedAddress },
      sessionKey: getAddress(rule.checkpointSessionKey),
      categoryName: "monitor",
      payloadHash,
    });
    await db.agentNotification.upsert({
      where: { deliveryKey },
      create: {
        userId: rule.userId,
        monitorRuleId: rule.id,
        type: "MONITOR_CHECKPOINT_READY",
        title: preflight.canSponsor ? "Monitor checkpoint ready" : "Monitor checkpoint prepared",
        body: preflight.canSponsor
          ? "A monitor checkpoint is eligible for sponsored publishing once the session signer submits it."
          : `A monitor checkpoint was prepared, but sponsorship is blocked by ${preflight.blockers.join(", ")}.`,
        deliveryKey,
        data: { payload, preflight },
      },
      update: {},
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "CHECKPOINT_PREFLIGHT_FAILED";
    await db.agentNotification.upsert({
      where: { deliveryKey },
      create: {
        userId: rule.userId,
        monitorRuleId: rule.id,
        type: "MONITOR_ERROR",
        title: "Monitor checkpoint preflight failed",
        body: code,
        deliveryKey,
        data: { payload, error: code },
      },
      update: {},
    });
  }
}

export async function syncMonitor(rule: MonitorRule) {
  if (!rule.isActive) return { payments: 0, throughBlock: rule.cursorBlock };
  const token = await readToken(BigInt(rule.tokenId));
  if (!token.configured) throw new Error("Mask Born collection is not configured.");
  if (token.owner.toLowerCase() !== rule.watchedAddress.toLowerCase()) {
    await db.monitorRule.update({ where: { id: rule.id }, data: { isActive: false, lastCheckedAt: new Date() } });
    return { payments: 0, throughBlock: rule.cursorBlock };
  }
  const latestBlock = await arcClient.getBlockNumber();
  let cursor = rule.cursorBlock;
  let payments = 0;
  while (cursor < latestBlock) {
    const fromBlock = cursor + 1n;
    const toBlock = fromBlock + BLOCK_BATCH - 1n > latestBlock ? latestBlock : fromBlock + BLOCK_BATCH - 1n;
    const logs = await logsFor(rule, fromBlock, toBlock);
    for (const log of logs) if (await recordPayment(rule, log)) payments += 1;
    cursor = toBlock;
    await db.monitorRule.update({ where: { id: rule.id }, data: { cursorBlock: cursor, lastCheckedAt: new Date() } });
  }
  await evaluateLateWindows(rule, new Date());
  await preflightMonitorCheckpoint(rule, payments, cursor);
  return { payments, throughBlock: cursor };
}

export async function syncActiveMonitors() {
  const rules = await db.monitorRule.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" }, take: 100 });
  const results: Array<{ id: string; ok: boolean; message?: string }> = [];
  for (const rule of rules) {
    try {
      await syncMonitor(rule);
      results.push({ id: rule.id, ok: true });
    } catch (error) {
      results.push({ id: rule.id, ok: false, message: error instanceof Error ? error.message : "Unknown monitor error" });
    }
  }
  return results;
}
