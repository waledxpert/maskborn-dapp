import { Router } from "express";
import { formatUnits, getAddress } from "viem";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import { requireWalletAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils.js";
import { maskBornAddress, readToken } from "../chain/client.js";

export const paydayRouter = Router();
const tokenParams = z.object({ tokenId: z.coerce.bigint().refine((value) => value > 0n && value <= 10_000n) });

function paydayStatus() {
  return {
    chainId: config.ARC_CHAIN_ID,
    network: config.ARC_CHAIN_ID === 5042002 ? "Arc Testnet" : "Arc",
    deployment: "NOT_DEPLOYED" as const,
    vaultAddress: null,
    enrollmentAvailable: false,
    claimsAvailable: false,
    claimable: null,
    estimate: null,
    reason: "The Mask Born Payday contract and funded reward vault have not been deployed.",
    accountingBoundary: "Creator fee-share obligations are separate and are never presented as token-holder Payday rewards.",
  };
}

function displayAmount(amount: bigint, decimals: number | null) {
  return decimals === null ? null : formatUnits(amount, decimals);
}

async function creatorRevenue(walletId: string) {
  const [feeShares, accruals, payouts] = await Promise.all([
    db.feeShare.findMany({
      where: { walletId },
      orderBy: { startsAt: "desc" },
      include: { galleryEntry: { include: { submission: { select: { title: true, slug: true } } } } },
    }),
    db.creatorAccrual.findMany({
      where: { feeShare: { walletId } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        tradeFeeEvent: { select: { currency: true, currencySymbol: true, currencyDecimals: true, txHash: true, blockNumber: true, occurredAt: true } },
        feeShare: { include: { galleryEntry: { include: { submission: { select: { title: true, slug: true } } } } } },
      },
    }),
    db.payout.findMany({ where: { walletId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const totals = new Map<string, { currency: string; symbol: string | null; decimals: number | null; status: string; amount: bigint }>();
  for (const accrual of accruals) {
    const event = accrual.tradeFeeEvent;
    const key = `${event.currency.toLowerCase()}:${event.currencyDecimals ?? "unknown"}:${accrual.status}`;
    const current = totals.get(key) ?? { currency: event.currency, symbol: event.currencySymbol, decimals: event.currencyDecimals, status: accrual.status, amount: 0n };
    current.amount += BigInt(accrual.amount.toString());
    totals.set(key, current);
  }

  return {
    status: accruals.length ? "TRACKED" : "NO_RECORDED_ACCRUALS",
    activeFeeShares: feeShares.filter((share) => !share.endsAt || share.endsAt > new Date()).map((share) => ({
      id: share.id,
      basisPoints: share.basisPoints,
      title: share.galleryEntry.submission.title,
      slug: share.galleryEntry.submission.slug,
      startsAt: share.startsAt,
      endsAt: share.endsAt,
    })),
    totals: [...totals.values()].map((total) => ({
      currency: total.currency,
      symbol: total.symbol,
      decimals: total.decimals,
      status: total.status,
      amountBaseUnits: total.amount.toString(),
      displayAmount: displayAmount(total.amount, total.decimals),
    })),
    recentAccruals: accruals.slice(0, 25).map((accrual) => ({
      id: accrual.id,
      status: accrual.status,
      amountBaseUnits: accrual.amount.toString(),
      displayAmount: displayAmount(BigInt(accrual.amount.toString()), accrual.tradeFeeEvent.currencyDecimals),
      currency: accrual.tradeFeeEvent.currency,
      symbol: accrual.tradeFeeEvent.currencySymbol,
      decimals: accrual.tradeFeeEvent.currencyDecimals,
      txHash: accrual.tradeFeeEvent.txHash,
      blockNumber: accrual.tradeFeeEvent.blockNumber.toString(),
      occurredAt: accrual.tradeFeeEvent.occurredAt,
      title: accrual.feeShare.galleryEntry.submission.title,
      slug: accrual.feeShare.galleryEntry.submission.slug,
    })),
    payouts: payouts.map((payout) => ({
      id: payout.id,
      status: payout.status,
      amountBaseUnits: payout.totalAmount.toString(),
      displayAmount: displayAmount(BigInt(payout.totalAmount.toString()), payout.currencyDecimals),
      currency: payout.currency,
      symbol: payout.currencySymbol,
      decimals: payout.currencyDecimals,
      txHash: payout.txHash,
      failureCode: payout.failureCode,
      createdAt: payout.createdAt,
      updatedAt: payout.updatedAt,
    })),
    notice: "These are creator fee-share records for accepted community artwork. They are not Mask Born NFT holder rewards or Payday claims.",
  };
}

paydayRouter.get("/payday/status", (_req, res) => {
  res.json(paydayStatus());
});

paydayRouter.get("/payday/me", requireWalletAuth, asyncRoute(async (req, res) => {
  res.json({ payday: paydayStatus(), creatorRevenue: await creatorRevenue(req.auth!.walletId!) });
}));

paydayRouter.get("/payday/tokens/:tokenId", requireWalletAuth, asyncRoute(async (req, res) => {
  const { tokenId } = tokenParams.parse(req.params);
  const token = await readToken(tokenId).catch(() => { throw new ApiError(503, "ARC_READ_UNAVAILABLE", "Arc ownership is temporarily unavailable."); });
  if (!token.configured) throw new ApiError(503, "COLLECTION_NOT_CONFIGURED", "The Mask Born collection is not configured.");
  if (getAddress(token.owner) !== getAddress(req.auth!.walletAddress!)) throw new ApiError(403, "TOKEN_NOT_OWNED", "This wallet does not currently own that Mask Born.");
  res.json({
    token: { tokenId: tokenId.toString(), owner: token.owner, collectionAddress: maskBornAddress, chainId: config.ARC_CHAIN_ID, asOfBlock: token.blockNumber.toString() },
    payday: { ...paydayStatus(), tokenWeight: null, enrolledTier: null, unclaimed: null, historicalAllocations: [] },
    creatorRevenue: await creatorRevenue(req.auth!.walletId!),
  });
}));
