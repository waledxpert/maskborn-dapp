import { Router } from "express";
import { formatUnits, getAddress, parseUnits } from "viem";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import { requireWalletAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils.js";
import { arcClient, maskBornAddress, readToken } from "../chain/client.js";
import { syncMonitor } from "./monitor-service.js";

export const notificationsRouter = Router();
const tokenParams = z.object({ tokenId: z.coerce.bigint().refine((value) => value > 0n && value <= 10_000n) });
const idParams = z.object({ id: z.string().cuid() });
const amount = z.string().regex(/^\d+(?:\.\d{1,6})?$/, "Use a positive USDC amount with no more than 6 decimals.");
const createRule = z.object({
  direction: z.enum(["INCOMING", "OUTGOING", "BOTH"]).default("INCOMING"),
  counterparty: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  minimumAmount: amount.default("0"),
  expectedAmount: amount.optional(),
  cadence: z.enum(["CONTINUOUS", "DAILY", "WEEKLY"]).default("CONTINUOUS"),
  nextExpectedAt: z.coerce.date().optional(),
  checkpointSessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  checkpointOnMatch: z.boolean().default(false),
  graceMinutes: z.coerce.number().int().min(0).max(10_080).default(60),
  lookbackBlocks: z.coerce.number().int().min(0).max(50_000).default(5_000),
}).superRefine((value, ctx) => {
  if (value.cadence !== "CONTINUOUS" && (!value.expectedAmount || !value.nextExpectedAt)) {
    ctx.addIssue({ code: "custom", message: "Scheduled monitors require expectedAmount and nextExpectedAt.", path: ["expectedAmount"] });
  }
  if (value.cadence !== "CONTINUOUS" && value.direction === "OUTGOING") {
    ctx.addIssue({ code: "custom", message: "Late-payment schedules must monitor incoming payments.", path: ["direction"] });
  }
});

async function assertTokenOwner(tokenId: bigint, walletAddress: string) {
  const token = await readToken(tokenId).catch(() => { throw new ApiError(503, "ARC_READ_UNAVAILABLE", "Arc ownership is temporarily unavailable."); });
  if (!token.configured) throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The Mask Born collection is not configured.");
  if (getAddress(token.owner) !== getAddress(walletAddress)) throw new ApiError(403, "TOKEN_NOT_OWNED", "This wallet does not currently own that Mask Born.");
  return token;
}

function presentRule(rule: {
  id: string; tokenId: string; direction: string; counterparty: string | null; minimumAmount: { toString(): string };
  expectedAmount: { toString(): string } | null; cadence: string; timezone: string; graceMinutes: number;
  nextExpectedAt: Date | null; checkpointSessionKey: string | null; checkpointOnMatch: boolean;
  cursorBlock: bigint; isActive: boolean; lastCheckedAt: Date | null; createdAt: Date;
}) {
  return {
    id: rule.id,
    tokenId: rule.tokenId,
    direction: rule.direction,
    counterparty: rule.counterparty,
    minimumAmount: formatUnits(BigInt(rule.minimumAmount.toString()), 6),
    expectedAmount: rule.expectedAmount ? formatUnits(BigInt(rule.expectedAmount.toString()), 6) : null,
    cadence: rule.cadence,
    timezone: rule.timezone,
    graceMinutes: rule.graceMinutes,
    nextExpectedAt: rule.nextExpectedAt,
    checkpointSessionKey: rule.checkpointSessionKey,
    checkpointOnMatch: rule.checkpointOnMatch,
    cursorBlock: rule.cursorBlock.toString(),
    isActive: rule.isActive,
    lastCheckedAt: rule.lastCheckedAt,
    createdAt: rule.createdAt,
  };
}

notificationsRouter.get("/agents/tokens/:tokenId/monitors", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  await assertTokenOwner(tokenId, req.auth!.walletAddress!);
  const rules = await db.monitorRule.findMany({
    where: { userId: req.auth!.userId, walletId: req.auth!.walletId!, chainId: config.ARC_CHAIN_ID, collectionAddress: maskBornAddress!, tokenId: tokenId.toString() },
    orderBy: { createdAt: "desc" },
  });
  res.json({ rules: rules.map(presentRule) });
}));

notificationsRouter.post("/agents/tokens/:tokenId/monitors", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const input = createRule.parse(req.body);
  await assertTokenOwner(tokenId, req.auth!.walletAddress!);
  const latestBlock = await arcClient.getBlockNumber();
  const lookback = BigInt(input.lookbackBlocks);
  const cursorBlock = latestBlock > lookback ? latestBlock - lookback : 0n;
  const rule = await db.monitorRule.create({
    data: {
      userId: req.auth!.userId,
      walletId: req.auth!.walletId!,
      chainId: config.ARC_CHAIN_ID,
      collectionAddress: maskBornAddress!,
      tokenId: tokenId.toString(),
      watchedAddress: getAddress(req.auth!.walletAddress!),
      direction: input.direction,
      counterparty: input.counterparty ? getAddress(input.counterparty) : null,
      minimumAmount: parseUnits(input.minimumAmount, 6).toString(),
      expectedAmount: input.expectedAmount ? parseUnits(input.expectedAmount, 6).toString() : null,
      cadence: input.cadence,
      timezone: "UTC",
      graceMinutes: input.graceMinutes,
      nextExpectedAt: input.nextExpectedAt ?? null,
      checkpointSessionKey: input.checkpointSessionKey ? getAddress(input.checkpointSessionKey) : null,
      checkpointOnMatch: input.checkpointOnMatch && Boolean(input.checkpointSessionKey),
      cursorBlock,
    },
  });
  res.status(201).json({ rule: presentRule(rule) });
}));

notificationsRouter.post("/agents/tokens/:tokenId/monitors/:id/sync", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const { id } = idParams.parse(req.params);
  await assertTokenOwner(tokenId, req.auth!.walletAddress!);
  const rule = await db.monitorRule.findFirst({ where: { id, userId: req.auth!.userId, walletId: req.auth!.walletId!, tokenId: tokenId.toString(), isActive: true } });
  if (!rule) throw new ApiError(404, "MONITOR_NOT_FOUND", "That active monitor was not found.");
  const result = await syncMonitor(rule);
  res.json({ payments: result.payments, throughBlock: result.throughBlock.toString() });
}));

notificationsRouter.delete("/agents/tokens/:tokenId/monitors/:id", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const { id } = idParams.parse(req.params);
  await assertTokenOwner(tokenId, req.auth!.walletAddress!);
  const result = await db.monitorRule.updateMany({ where: { id, userId: req.auth!.userId, walletId: req.auth!.walletId!, tokenId: tokenId.toString() }, data: { isActive: false } });
  if (!result.count) throw new ApiError(404, "MONITOR_NOT_FOUND", "That monitor was not found.");
  res.status(204).end();
}));

notificationsRouter.get("/notifications", requireWalletAuth, asyncRoute(async (req, res) => {
  const notifications = await db.agentNotification.findMany({
    where: { userId: req.auth!.userId, monitorRule: { walletId: req.auth!.walletId! } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ notifications });
}));

notificationsRouter.post("/notifications/:id/read", requireWalletAuth, asyncRoute(async (req, res) => {
  const { id } = idParams.parse(req.params);
  const result = await db.agentNotification.updateMany({
    where: { id, userId: req.auth!.userId, monitorRule: { walletId: req.auth!.walletId! } },
    data: { readAt: new Date() },
  });
  if (!result.count) throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "That notification was not found.");
  res.status(204).end();
}));
