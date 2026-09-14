import { formatUnits, getAddress, keccak256, parseUnits, stringToHex } from "viem";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import type { IntelligenceReportKind } from "../../generated/prisma/client.js";
import { buildPersona } from "../agents/persona.js";
import { readSponsorshipPolicy } from "../agents/sponsorship.js";
import { maskBornAddress, readAgentAccount, readAgentBinding, readNativeUsdc, readToken } from "../chain/client.js";

export const REPORT_CATALOG: Array<{ kind: IntelligenceReportKind; title: string; description: string }> = [
  { kind: "COLLECTION_HEALTH", title: "Collection health", description: "High-level Mask Born configuration, Arc deployment and current utility readiness." },
  { kind: "WALLET_ACTIVITY", title: "Wallet activity", description: "Recent Mask Born ownership activity and current Arc native USDC balance." },
  { kind: "USDC_STREAM_SUMMARY", title: "USDC stream summary", description: "Monitor rules, recent matched USDC payments and late-payment signals." },
  { kind: "AGENT_PROFILE", title: "Agent profile", description: "Trait-derived persona, public identity, account and capability summary." },
  { kind: "CHECKPOINT_SUMMARY", title: "Checkpoint summary", description: "Checkpoint session support, prepared checkpoint alerts and sponsorship blockers." },
];

type QuoteInput = {
  kind: IntelligenceReportKind;
  tokenId?: bigint;
  walletAddress?: string;
  userId?: string;
  walletId?: string;
};

export function readIntelligenceStatus() {
  return {
    configured: config.INTELLIGENCE_X402_MODE !== "disabled",
    mode: config.INTELLIGENCE_X402_MODE,
    currency: "USDC",
    publicPrice: config.INTELLIGENCE_PUBLIC_PRICE_USDC,
    holderPrice: config.INTELLIGENCE_HOLDER_PRICE_USDC,
    receiverAddress: config.INTELLIGENCE_RECEIVER_ADDRESS ?? null,
    holderDiscount: true,
    x402Verification: config.INTELLIGENCE_X402_MODE === "live" ? "required" : "disabled",
  };
}

async function isCurrentHolder(tokenId: bigint | undefined, walletAddress: string | undefined) {
  if (!tokenId || !walletAddress) return false;
  const token = await readToken(tokenId).catch(() => null);
  return Boolean(token?.configured && getAddress(token.owner) === getAddress(walletAddress));
}

export async function createIntelligenceQuote(input: QuoteInput) {
  if (!REPORT_CATALOG.some((item) => item.kind === input.kind)) throw new ApiError(422, "UNKNOWN_REPORT_KIND", "That intelligence report kind is not supported.");
  const holder = await isCurrentHolder(input.tokenId, input.walletAddress);
  const publicPrice = parseUnits(config.INTELLIGENCE_PUBLIC_PRICE_USDC, 6);
  const holderPrice = parseUnits(config.INTELLIGENCE_HOLDER_PRICE_USDC, 6);
  const charged = holder ? holderPrice : publicPrice;
  const expiresAt = new Date(Date.now() + config.INTELLIGENCE_QUOTE_TTL_SECONDS * 1_000);
  const identity = [input.kind, input.tokenId?.toString() ?? "public", input.walletAddress ? getAddress(input.walletAddress).toLowerCase() : "anonymous", Date.now().toString()].join(":");
  const requestKey = keccak256(stringToHex(identity));
  const entitlement = await db.intelligenceEntitlement.create({
    data: {
      requestKey,
      kind: input.kind,
      tokenId: input.tokenId?.toString() ?? null,
      walletAddress: input.walletAddress ? getAddress(input.walletAddress) : null,
      userId: input.userId ?? null,
      walletId: input.walletId ?? null,
      status: config.INTELLIGENCE_X402_MODE === "disabled" || config.INTELLIGENCE_X402_MODE === "test" ? "PAID" : "PAYMENT_REQUIRED",
      publicPriceBaseUnits: publicPrice.toString(),
      holderPriceBaseUnits: holderPrice.toString(),
      chargedPriceBaseUnits: charged.toString(),
      isHolderRate: holder,
      paymentMode: config.INTELLIGENCE_X402_MODE,
      x402Resource: `/api/intelligence/reports/${requestKey}`,
      expiresAt,
    },
  });
  return serializeEntitlement(entitlement);
}

export async function getEntitlementByRequestKey(requestKey: string) {
  const entitlement = await db.intelligenceEntitlement.findUnique({ where: { requestKey }, include: { report: true } });
  if (!entitlement) throw new ApiError(404, "REPORT_QUOTE_NOT_FOUND", "That report quote was not found.");
  if (entitlement.expiresAt.getTime() <= Date.now() && !["FULFILLED", "PAID"].includes(entitlement.status)) {
    const expired = await db.intelligenceEntitlement.update({ where: { id: entitlement.id }, data: { status: "EXPIRED" }, include: { report: true } });
    return expired;
  }
  return entitlement;
}

export async function generateReport(requestKey: string) {
  const entitlement = await getEntitlementByRequestKey(requestKey);
  if (!["PAID", "FULFILLED"].includes(entitlement.status)) throw new ApiError(402, "X402_PAYMENT_REQUIRED", "Payment verification is required before this report can be generated.");
  if (entitlement.report?.status === "READY") return serializeReport(entitlement.report);

  const content = await buildReportContent(entitlement.kind, entitlement.tokenId ? BigInt(entitlement.tokenId) : undefined, entitlement.walletAddress ?? undefined);
  const report = await db.intelligenceReport.upsert({
    where: { entitlementId: entitlement.id },
    create: {
      entitlementId: entitlement.id,
      kind: entitlement.kind,
      status: "READY",
      title: content.title,
      summary: content.summary,
      content: content.body,
      sourceRefs: content.sources,
      generatedAt: new Date(),
    },
    update: {
      status: "READY",
      title: content.title,
      summary: content.summary,
      content: content.body,
      sourceRefs: content.sources,
      generatedAt: new Date(),
      failureCode: null,
    },
  });
  await db.intelligenceEntitlement.update({ where: { id: entitlement.id }, data: { status: "FULFILLED", fulfilledAt: new Date() } });
  return serializeReport(report);
}

async function buildReportContent(kind: IntelligenceReportKind, tokenId?: bigint, walletAddress?: string) {
  const token = tokenId ? await readToken(tokenId).catch(() => null) : null;
  const binding = tokenId ? await readAgentBinding(tokenId).catch(() => null) : null;
  const account = binding?.configured && binding.awakened ? await readAgentAccount(binding.account).catch(() => null) : null;
  const wallet = walletAddress ? await readNativeUsdc(getAddress(walletAddress)).catch(() => null) : null;
  const [monitorRules, notifications, recentTransfers] = await Promise.all([
    tokenId ? db.monitorRule.findMany({ where: { tokenId: tokenId.toString(), ...(walletAddress ? { watchedAddress: getAddress(walletAddress) } : {}) }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    tokenId ? db.agentNotification.findMany({ where: { monitorRule: { tokenId: tokenId.toString(), ...(walletAddress ? { watchedAddress: getAddress(walletAddress) } : {}) } }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    tokenId ? db.chainEvent.findMany({ where: { chainId: config.ARC_CHAIN_ID, collectionAddress: maskBornAddress!.toLowerCase(), tokenId: tokenId.toString() }, orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }], take: 10 }) : [],
  ]);
  const persona = token?.configured && token.traits ? buildPersona(tokenId!, token.traits.map(Number)) : null;
  const base = {
    kind,
    chainId: config.ARC_CHAIN_ID,
    collectionAddress: maskBornAddress,
    token: token?.configured ? { tokenId: tokenId?.toString(), owner: token.owner, revealed: token.revealed, persona, asOfBlock: token.blockNumber.toString() } : null,
    agent: binding?.configured ? { awakened: binding.awakened, account: binding.awakened ? binding.account : null, agentId: binding.awakened ? binding.agentId.toString() : null } : null,
    account: account ? { nativeUsdc: formatUnits(account.balance, 18), executionPaused: account.paused, checkpointSessions: Boolean(account.checkpointSessions), erc4337: Boolean(account.erc4337), userOpNonce: account.erc4337?.userOpNonce.toString() ?? null, asOfBlock: account.blockNumber.toString() } : null,
    wallet: wallet ? { address: walletAddress ? getAddress(walletAddress) : null, nativeUsdc: formatUnits(wallet.balance, 18), asOfBlock: wallet.blockNumber.toString() } : null,
    monitoring: { rules: monitorRules.length, checkpointEnabledRules: monitorRules.filter((rule) => rule.checkpointOnMatch).length, notifications: notifications.length, checkpointReady: notifications.filter((item) => item.type === "MONITOR_CHECKPOINT_READY").length },
    sponsorship: readSponsorshipPolicy(),
    recentTransfers: recentTransfers.map((event) => ({ txHash: event.txHash, blockNumber: event.blockNumber.toString(), from: event.fromAddress, to: event.toAddress, blockTime: event.blockTime })),
  };
  const title = REPORT_CATALOG.find((item) => item.kind === kind)?.title ?? "Mask Born report";
  const summary = summarize(kind, base);
  return { title, summary, body: base, sources: { generatedFrom: ["Arc reads", "Mask Born index", "monitor records", "sponsorship policy"] } };
}

function summarize(kind: IntelligenceReportKind, data: Record<string, unknown>) {
  const token = data.token as { tokenId?: string; revealed?: boolean } | null;
  const agent = data.agent as { awakened?: boolean } | null;
  const account = data.account as { checkpointSessions?: boolean; erc4337?: boolean } | null;
  const monitoring = data.monitoring as { rules: number; checkpointReady: number };
  switch (kind) {
    case "COLLECTION_HEALTH": return `Mask Born is configured on Arc with ${agent?.awakened ? "an awakened" : "no awakened"} selected agent context.`;
    case "WALLET_ACTIVITY": return `Wallet report for Mask Born #${token?.tokenId ?? "unknown"}; recent transfer and native USDC facts are included where available.`;
    case "USDC_STREAM_SUMMARY": return `${monitoring.rules} monitor rule(s) found with ${monitoring.checkpointReady} checkpoint-ready alert(s).`;
    case "AGENT_PROFILE": return `Agent profile is ${agent?.awakened ? "awakened" : "not awakened"}; token reveal status is ${token?.revealed ? "revealed" : "unrevealed"}.`;
    case "CHECKPOINT_SUMMARY": return `Checkpoint support: sessions ${account?.checkpointSessions ? "yes" : "no"}, ERC-4337 ${account?.erc4337 ? "yes" : "no"}.`;
  }
}

export function serializeEntitlement(entitlement: {
  requestKey: string; kind: IntelligenceReportKind; tokenId: string | null; walletAddress: string | null; status: string; currency: string;
  publicPriceBaseUnits: { toString(): string }; holderPriceBaseUnits: { toString(): string }; chargedPriceBaseUnits: { toString(): string };
  isHolderRate: boolean; paymentMode: string; x402Resource: string | null; expiresAt: Date; createdAt: Date;
}) {
  return {
    requestKey: entitlement.requestKey,
    kind: entitlement.kind,
    tokenId: entitlement.tokenId,
    walletAddress: entitlement.walletAddress,
    status: entitlement.status.toLowerCase(),
    currency: entitlement.currency,
    publicPrice: formatUnits(BigInt(entitlement.publicPriceBaseUnits.toString()), 6),
    holderPrice: formatUnits(BigInt(entitlement.holderPriceBaseUnits.toString()), 6),
    chargedPrice: formatUnits(BigInt(entitlement.chargedPriceBaseUnits.toString()), 6),
    chargedPriceBaseUnits: entitlement.chargedPriceBaseUnits.toString(),
    isHolderRate: entitlement.isHolderRate,
    paymentMode: entitlement.paymentMode,
    x402Resource: entitlement.x402Resource,
    expiresAt: entitlement.expiresAt.toISOString(),
    createdAt: entitlement.createdAt.toISOString(),
  };
}

export function serializeReport(report: { id: string; kind: IntelligenceReportKind; status: string; title: string; summary: string; content: unknown; sourceRefs: unknown; generatedAt: Date | null; createdAt: Date }) {
  return {
    id: report.id,
    kind: report.kind,
    status: report.status.toLowerCase(),
    title: report.title,
    summary: report.summary,
    content: report.content,
    sourceRefs: report.sourceRefs,
    generatedAt: report.generatedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
  };
}