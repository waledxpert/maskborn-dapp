import { formatUnits, getAddress } from "viem";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { readCheckpointSubmitterStatus } from "../agents/checkpoint-submit.js";
import { getTokenSponsorshipBudget, readSponsorshipPolicy } from "../agents/sponsorship.js";
import { maskBornAddress, readAgentAccount, readAgentBinding, readNativeUsdc } from "../chain/client.js";
import type { ActionAuth } from "../agents/actions.js";

export async function buildHolderBriefing(input: { tokenId: bigint; walletAddress: string; auth: ActionAuth }) {
  const walletAddress = getAddress(input.walletAddress);
  const [balance, binding, monitors, notifications, sponsorshipPolicy] = await Promise.all([
    readNativeUsdc(walletAddress).catch(() => null),
    readAgentBinding(input.tokenId).catch(() => null),
    db.monitorRule.findMany({
      where: { walletId: input.auth.walletId, tokenId: input.tokenId.toString(), isActive: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.agentNotification.findMany({
      where: { userId: input.auth.userId, monitorRule: { walletId: input.auth.walletId, tokenId: input.tokenId.toString() } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    Promise.resolve(readSponsorshipPolicy()),
  ]);
  const account = binding?.configured && binding.awakened ? await readAgentAccount(binding.account).catch(() => null) : null;
  const budget = await getTokenSponsorshipBudget(input.tokenId, input.auth).catch(() => null);
  const checkpointReady = notifications.filter((notification) => notification.type === "MONITOR_CHECKPOINT_READY");
  const suggestions = [
    !binding?.configured ? "Configure the Mask Born agent registry before awakening." : null,
    binding?.configured && !binding.awakened ? "Awaken this Mask Born to unlock the agent account and checkpoint sessions." : null,
    binding?.configured && binding.awakened && !account?.checkpointSessions ? "This account does not expose checkpoint sessions; use the latest V2 account for checkpoint utility." : null,
    monitors.length === 0 ? "Create a USDC stream monitor for incoming payments you care about." : null,
    monitors.some((rule) => rule.checkpointOnMatch && !rule.checkpointSessionKey) ? "Add a checkpoint session key to monitors that should prepare onchain evidence." : null,
    sponsorshipPolicy.enabled ? null : `Sponsored gas is not live yet: ${sponsorshipPolicy.disabledReason ?? "SPONSORSHIP_DISABLED"}.`,
    checkpointReady.length > 0 ? "Review the latest checkpoint-ready notification and submit it with the granted session key if desired." : null,
  ].filter((value): value is string => Boolean(value));
  return {
    tokenId: input.tokenId.toString(),
    wallet: {
      address: walletAddress,
      nativeUsdc: balance ? formatUnits(balance.balance, 18) : null,
      asOfBlock: balance?.blockNumber.toString() ?? null,
    },
    agent: binding?.configured ? {
      awakened: binding.awakened,
      account: binding.awakened ? binding.account : null,
      agentId: binding.awakened ? binding.agentId.toString() : null,
    } : { awakened: false, account: null, agentId: null },
    account: account ? {
      executionPaused: account.paused,
      nativeUsdc: formatUnits(account.balance, 18),
      checkpointSessions: Boolean(account.checkpointSessions),
      erc4337: account.erc4337 ? { supported: true, userOpNonce: account.erc4337.userOpNonce.toString(), entryPoint: account.erc4337.entryPoint } : { supported: false },
      asOfBlock: account.blockNumber.toString(),
    } : null,
    monitoring: {
      activeRules: monitors.length,
      checkpointEnabledRules: monitors.filter((rule) => rule.checkpointOnMatch).length,
      unreadNotifications: notifications.filter((notification) => !notification.readAt).length,
      checkpointReady: checkpointReady.length,
    },
    sponsorship: {
      enabled: sponsorshipPolicy.enabled,
      disabledReason: sponsorshipPolicy.disabledReason,
      eligibleOperations: sponsorshipPolicy.eligibleOperations,
      remainingUsdc: budget ? formatUnits(BigInt(budget.remainingBaseUnits), 18) : null,
      remainingTransactions: budget?.remainingTransactions ?? null,
    },
    checkpointSubmitter: readCheckpointSubmitterStatus(),
    suggestions,
    source: {
      chainId: config.ARC_CHAIN_ID,
      collectionAddress: maskBornAddress,
    },
  };
}