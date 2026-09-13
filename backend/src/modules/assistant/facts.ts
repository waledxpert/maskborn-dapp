import { formatUnits, getAddress } from "viem";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import { buildPersona } from "../agents/persona.js";
import { maskBornAddress, readNativeUsdc, readToken } from "../chain/client.js";

type JsonObject = Record<string, unknown>;

async function recordedTool<T extends JsonObject>(conversationId: string, messageId: string, toolName: string, run: () => Promise<T>) {
  const toolRun = await db.toolRun.create({ data: { conversationId, messageId, toolName, status: "RUNNING" } });
  try {
    const output = await run();
    await db.toolRun.update({ where: { id: toolRun.id }, data: { status: "COMPLETED", output: output as Prisma.InputJsonValue, completedAt: new Date() } });
    return output;
  } catch (error) {
    await db.toolRun.update({ where: { id: toolRun.id }, data: { status: "FAILED", errorCode: "READ_UNAVAILABLE", completedAt: new Date() } });
    return { status: "unavailable" } as unknown as T;
  }
}

export async function gatherAgentFacts(input: {
  conversationId: string;
  messageId: string;
  tokenId: bigint;
  userId: string;
  walletId: string;
  walletAddress: string;
}) {
  const agent = await recordedTool(input.conversationId, input.messageId, "readAgent", async () => {
    const token = await readToken(input.tokenId);
    if (!token.configured) return { status: "unavailable" };
    const persona = token.traits ? buildPersona(input.tokenId, token.traits.map(Number)) : null;
    return {
      status: "available",
      chainId: config.ARC_CHAIN_ID,
      collectionAddress: maskBornAddress,
      tokenId: input.tokenId.toString(),
      owner: token.owner,
      revealed: token.revealed,
      asOfBlock: token.blockNumber.toString(),
      persona,
    };
  });

  const balances = await recordedTool(input.conversationId, input.messageId, "readBalances", async () => {
    const result = await readNativeUsdc(getAddress(input.walletAddress));
    return {
      status: "available",
      address: getAddress(input.walletAddress),
      asset: "USDC",
      nativeBaseUnits: result.balance.toString(),
      nativeInternalDecimals: 18,
      displayAmount: formatUnits(result.balance, 18),
      asOfBlock: result.blockNumber.toString(),
    };
  });

  const activity = await recordedTool(input.conversationId, input.messageId, "readActivity", async () => {
    const [nftTransfers, paymentMatches] = await Promise.all([
      db.chainEvent.findMany({
        where: { chainId: config.ARC_CHAIN_ID, collectionAddress: maskBornAddress!.toLowerCase(), tokenId: input.tokenId.toString() },
        orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
        take: 10,
        select: { txHash: true, blockNumber: true, fromAddress: true, toAddress: true, blockTime: true },
      }),
      db.monitorMatch.findMany({
        where: { monitorRule: { walletId: input.walletId, tokenId: input.tokenId.toString(), isActive: true } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { observedPayment: true },
      }),
    ]);
    return {
      status: "available",
      nftTransfers: nftTransfers.map((event) => ({ ...event, blockNumber: event.blockNumber.toString() })),
      usdcPayments: paymentMatches.map((match) => ({
        direction: match.direction,
        txHash: match.observedPayment.txHash,
        from: match.observedPayment.fromAddress,
        to: match.observedPayment.toAddress,
        amount: formatUnits(BigInt(match.observedPayment.amount.toString()), 6),
        amountBaseUnits: match.observedPayment.amount.toString(),
        decimals: 6,
        blockNumber: match.observedPayment.blockNumber.toString(),
        blockTime: match.observedPayment.blockTime,
      })),
    };
  });

  const monitoring = await recordedTool(input.conversationId, input.messageId, "readMonitoring", async () => {
    const [rules, unread] = await Promise.all([
      db.monitorRule.findMany({
        where: { walletId: input.walletId, tokenId: input.tokenId.toString(), isActive: true },
        select: { id: true, direction: true, minimumAmount: true, expectedAmount: true, cadence: true, nextExpectedAt: true, lastCheckedAt: true },
      }),
      db.agentNotification.count({ where: { userId: input.userId, readAt: null, monitorRule: { walletId: input.walletId } } }),
    ]);
    return {
      status: "available",
      activeRules: rules.map((rule) => ({
        ...rule,
        minimumAmount: formatUnits(BigInt(rule.minimumAmount.toString()), 6),
        expectedAmount: rule.expectedAmount ? formatUnits(BigInt(rule.expectedAmount.toString()), 6) : null,
      })),
      unreadNotifications: unread,
    };
  });

  const payday = await recordedTool(input.conversationId, input.messageId, "readPayday", async () => ({
    status: "not_deployed",
    claimable: null,
    message: "Mask Born Payday contracts are not deployed. No claimable or projected reward is available.",
  }));

  return {
    facts: { agent, balances, activity, monitoring, payday },
    sources: [
      { tool: "readAgent", source: "Arc contract reads", asOfBlock: "asOfBlock" in agent ? agent.asOfBlock : null },
      { tool: "readBalances", source: "Arc eth_getBalance", asOfBlock: "asOfBlock" in balances ? balances.asOfBlock : null },
      { tool: "readActivity", source: "Mask Born ownership index and unified Arc USDC Transfer events" },
      { tool: "readMonitoring", source: "Holder-private monitoring records" },
      { tool: "readPayday", source: "Deployment configuration" },
    ],
  };
}
