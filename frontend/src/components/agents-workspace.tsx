"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, CheckCircle2, ExternalLink, LoaderCircle, MessageSquare, RefreshCw, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { composeMaskbornDataUrl, type TraitSelection } from "@/lib/maskborn-renderer";
import { PixelArtwork } from "@/components/pixel-artwork";
import { useCurrentUser } from "@/hooks/use-current-user";

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type AgentStatus = { configured: boolean; network: string; chainId: number; collectionAddress: string | null; agentRegistryAddress?: string | null; phase: number; awakening?: string; accountAbstraction?: { entryPoint: string; accountPath: string; directEntryPointSmoke: boolean; bundlerProvider: string; bundlerConfigured: boolean; paymasterProvider: string; sponsorship: boolean; sponsorshipReason?: string | null; dailySponsorAllowance?: string; dailySponsorTransactions?: number } };
type BundlerStatus = { configured: boolean; provider: string; chainId: number | null; expectedChainId: number; chainMatches: boolean; entryPoint: string; supportedEntryPoints: string[]; entryPointSupported: boolean; paymasterProvider: string; sponsorship: boolean };
type SponsorshipStatus = { enabled: boolean; disabledReason: string | null; currency: string; gasAsset: string; dailyAllowance: string; dailyAllowanceBaseUnits: string; dailyTransactionLimit: number; reservationTtlSeconds: number; eligibleActions: string[]; eligibleOperations?: string[]; excludedActions: string[]; bundlerProvider: string; paymasterProvider: string; paymasterConfigured?: boolean; paymasterPolicyConfigured?: boolean; accountingMode: string; settlementMode: string; notes: string[] };
type SponsorshipBudget = { policy: SponsorshipStatus; tokenId: string; dailyBucket: string; usedBaseUnits: string; remainingBaseUnits: string; usedTransactions: number; remainingTransactions: number; reservations: Array<{ id: string; status: string; actionType: string; reservedCostBaseUnits: string; actualCostBaseUnits: string | null; expiresAt: string; failureCode: string | null }> };
type AgentIndexStatus = { configured: boolean; latestBlock?: string; indexedThrough?: string | null; caughtUp?: boolean; lastError?: string | null };
type AwakeningState = {
  configured: boolean;
  awakened?: boolean;
  account?: string;
  agentId?: string | null;
  constitutionHash?: string | null;
  awakenedAtBlock?: string | null;
  asOfBlock?: string;
  accountState?: null | {
    nativeUsdc: string; nativeUsdcBaseUnits: string; executionPaused: boolean; state: string; asOfBlock: string;
    checkpointSessions: { supported: boolean; maxDurationSeconds?: string; maxCalls?: string };
    erc4337: { supported: boolean; version?: string; entryPoint?: string; userOpNonce?: string; executionScope?: string; sponsorship?: boolean; bundlerProvider?: string; bundlerConfigured?: boolean; paymasterProvider?: string };
  };
};
type AgentPreview = {
  token: { tokenId: string; owner: string; revealed: boolean; asOfBlock: string };
  persona: null | {
    name: string;
    role: string;
    summary: string;
    communicationStyle: string;
    traits: Array<{ category: string; index: number; name: string; tier: string }>;
  };
  wallet: { nativeUsdc?: string; asOfBlock?: string; unavailable?: boolean };
  awakening: AwakeningState;
  capabilities: Array<{ id: string; label: string; status: string }>;
};
type PreparedAwakening = {
  id: string;
  status: "prepared";
  chainId: number;
  from: string;
  to: string;
  data: string;
  value: string;
  gasEstimate: string;
  predictedAccount: string;
  agentURI: string;
  constitutionHash: string;
  expiresAt: string;
};
type AgentAction = {
  id: string; status: "prepared" | "submitted" | "confirmed" | "failed" | "expired" | "unknown";
  type: "AWAKEN" | "SET_EXECUTION_PAUSED" | "UPDATE_AGENT_URI" | "SEND_NATIVE_USDC" | "GRANT_CHECKPOINT_SESSION" | "REVOKE_CHECKPOINT_SESSION";
  chainId: number; tokenId: string; account: string; from: string; to: string; data: string; value: string;
  assetAmountBaseUnits: string | null; payload: Record<string, string | number | boolean | null>;
  gasEstimate: string | null; expiresAt: string; txHash: string | null; failureCode: string | null; createdAt: string;
};
type CheckpointSessionState = {
  sessionKey: string; authorizedOwner: string | null; validAfter: string; validUntil: string;
  maxCalls: string; calls: string; revoked: boolean; active: boolean; asOfBlock: string;
};
type OwnedTokens = { tokenIds: string[]; asOfBlock: string };
type MonitorRule = {
  id: string; direction: "INCOMING" | "OUTGOING" | "BOTH"; minimumAmount: string;
  expectedAmount: string | null; cadence: "CONTINUOUS" | "DAILY" | "WEEKLY";
  nextExpectedAt: string | null; checkpointSessionKey: string | null; checkpointOnMatch: boolean;
  isActive: boolean; lastCheckedAt: string | null;
};
type AgentNotification = {
  id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string; data?: unknown;
};
type CheckpointNotificationData = {
  preflight?: {
    account?: string;
    entryPoint?: string;
    nonce?: string;
    callData?: string;
    categoryName?: "monitor" | "report" | "liveness";
    payloadHash?: string;
    canSponsor?: boolean;
    blockers?: string[];
    userOperationHash?: string;
    session?: { sessionKey?: string; validUntil?: string; calls?: string; maxCalls?: string };
  };
};
type AgentBriefing = {
  wallet: { nativeUsdc: string | null; asOfBlock: string | null };
  agent: { awakened: boolean; account: string | null; agentId: string | null };
  account: null | { executionPaused: boolean; nativeUsdc: string; checkpointSessions: boolean; erc4337: { supported: boolean; userOpNonce?: string; entryPoint?: string }; asOfBlock: string };
  monitoring: { activeRules: number; checkpointEnabledRules: number; unreadNotifications: number; checkpointReady: number };
  sponsorship: { enabled: boolean; disabledReason: string | null; eligibleOperations: string[]; remainingUsdc: string | null; remainingTransactions: number | null };
  checkpointSubmitter: { configured: boolean; signerAddress: string | null; autosubmit: boolean; scope: string };
  suggestions: string[];
};
type ChatStatus = { configured: boolean; provider: string; model: string | null; destinationOrigin: string | null; dailyRequestLimit: number; readOnly: boolean; sharedFields: string[] };
type ModelConsent = { consented: boolean; provider: ChatStatus; sharedFields: string[] };
type ConversationSummary = { id: string; title: string | null; updatedAt: string };
type ConversationMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; createdAt: string };

declare global { interface Window { ethereum?: EthereumProvider } }

function compact(address: string) { return `${address.slice(0, 7)}Ã¢â‚¬Â¦${address.slice(-5)}`; }

function checkpointNotificationData(notification: AgentNotification) {
  if (notification.type !== "MONITOR_CHECKPOINT_READY" || !notification.data || typeof notification.data !== "object") return null;
  const data = notification.data as CheckpointNotificationData;
  const preflight = data.preflight;
  if (!preflight?.payloadHash || !preflight.categoryName || !preflight.session?.sessionKey) return null;
  return preflight;
}
async function submitPrepared(provider: EthereumProvider, prepared: Pick<AgentAction, "id" | "chainId" | "from" | "to" | "data" | "value" | "expiresAt">, onSubmitted?: (hash: string) => void) {
  if (Date.now() >= Date.parse(prepared.expiresAt)) throw new Error("This preparation expired. Prepare it again.");
  const requiredChain = `0x${prepared.chainId.toString(16)}`;
  const currentChain = await provider.request({ method: "eth_chainId" }) as string;
  if (currentChain.toLowerCase() !== requiredChain.toLowerCase()) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: requiredChain }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: requiredChain,
          chainName: "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: ["https://rpc.testnet.arc.network"],
          blockExplorerUrls: ["https://testnet.arcscan.app"],
        }],
      });
    }
  }
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: prepared.from, to: prepared.to, data: prepared.data, value: prepared.value }],
  }) as string;
  onSubmitted?.(hash);
  let action = await apiFetch<AgentAction>(`/agents/actions/${prepared.id}/submitted`, {
    method: "POST", body: JSON.stringify({ txHash: hash }),
  });
  for (let attempt = 0; attempt < 40 && ["submitted", "unknown"].includes(action.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    action = await apiFetch<AgentAction>(`/agents/actions/${prepared.id}`);
  }
  return { hash, action };
}

export function AgentsWorkspace() {
  const queryClient = useQueryClient();
  const session = useCurrentUser();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState("");
  const [preview, setPreview] = useState<AgentPreview | null>(null);
  const [error, setError] = useState("");
  const [minimumAmount, setMinimumAmount] = useState("0");
  const [expectedAmount, setExpectedAmount] = useState("");
  const [cadence, setCadence] = useState<"CONTINUOUS" | "DAILY" | "WEEKLY">("CONTINUOUS");
  const [nextExpectedAt, setNextExpectedAt] = useState("");
  const [checkpointOnMatch, setCheckpointOnMatch] = useState(false);
  const [monitorCheckpointSessionKey, setMonitorCheckpointSessionKey] = useState("");
  const [chatText, setChatText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
  const [consentChecked, setConsentChecked] = useState(false);
  const [preparedAwakening, setPreparedAwakening] = useState<PreparedAwakening | null>(null);
  const [awakeningTxHash, setAwakeningTxHash] = useState<string | null>(null);
  const [awakeningTxStatus, setAwakeningTxStatus] = useState<"idle" | "submitted" | "confirmed" | "failed" | "unknown">("idle");
  const [preparedControl, setPreparedControl] = useState<AgentAction | null>(null);
  const [agentURI, setAgentURI] = useState("");
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [controlTxHash, setControlTxHash] = useState<string | null>(null);
  const [controlTxStatus, setControlTxStatus] = useState<AgentAction["status"] | "idle">("idle");
  const [sessionKey, setSessionKey] = useState("");
  const [sessionHours, setSessionHours] = useState("6");
  const [sessionMaxCalls, setSessionMaxCalls] = useState("24");
  const [sessionState, setSessionState] = useState<CheckpointSessionState | null>(null);
  const status = useQuery({ queryKey: ["agent-status"], queryFn: () => apiFetch<AgentStatus>("/agents/status") });
  const bundlerStatus = useQuery({ queryKey: ["agent-bundler-status"], queryFn: () => apiFetch<BundlerStatus>("/agents/bundler/status"), enabled: Boolean(status.data?.accountAbstraction?.bundlerConfigured), retry: false, refetchInterval: 30_000 });
  const sponsorshipStatus = useQuery({ queryKey: ["agent-sponsorship-status"], queryFn: () => apiFetch<SponsorshipStatus>("/agents/sponsorship/status"), retry: false, refetchInterval: 30_000 });
  const indexStatus = useQuery({ queryKey: ["agent-index-status"], queryFn: () => apiFetch<AgentIndexStatus>("/agents/index/status"), enabled: Boolean(status.data?.configured), refetchInterval: 15_000, retry: false });
  const chatStatus = useQuery({ queryKey: ["agent-chat-status"], queryFn: () => apiFetch<ChatStatus>("/agents/chat/status"), retry: false });
  const connectedAddress = walletAddress ?? session.data?.user?.wallets.find(
    (wallet) => wallet.chain === "EVM" && wallet.verifiedAt,
  )?.address ?? null;
  const owned = useQuery({
    queryKey: ["agent-owned", connectedAddress],
    queryFn: () => apiFetch<OwnedTokens>("/agents/owned"),
    enabled: Boolean(connectedAddress && status.data?.configured),
    retry: false,
  });
  const monitors = useQuery({
    queryKey: ["agent-monitors", tokenId],
    queryFn: () => apiFetch<{ rules: MonitorRule[] }>(`/agents/tokens/${tokenId}/monitors`),
    enabled: Boolean(preview && tokenId),
    retry: false,
  });
  const notifications = useQuery({
    queryKey: ["agent-notifications", connectedAddress],
    queryFn: () => apiFetch<{ notifications: AgentNotification[] }>("/notifications"),
    enabled: Boolean(connectedAddress && preview),
    retry: false,
  });
  const briefing = useQuery({
    queryKey: ["agent-briefing", tokenId],
    queryFn: () => apiFetch<AgentBriefing>(`/agents/tokens/${tokenId}/briefing`),
    enabled: Boolean(preview && tokenId && connectedAddress && indexStatus.data?.caughtUp),
    retry: false,
    refetchInterval: 30_000,
  });
  const modelConsent = useQuery({
    queryKey: ["agent-model-consent", tokenId],
    queryFn: () => apiFetch<ModelConsent>(`/agents/tokens/${tokenId}/model-consent`),
    enabled: Boolean(preview && tokenId && indexStatus.data?.caughtUp),
    retry: false,
  });
  const conversations = useQuery({
    queryKey: ["agent-conversations", tokenId],
    queryFn: () => apiFetch<{ conversations: ConversationSummary[] }>(`/agents/tokens/${tokenId}/conversations`),
    enabled: Boolean(preview && tokenId && indexStatus.data?.caughtUp),
    retry: false,
  });
  const sponsorshipBudget = useQuery({
    queryKey: ["agent-sponsorship-budget", tokenId],
    queryFn: () => apiFetch<SponsorshipBudget>(`/agents/tokens/${tokenId}/sponsorship/budget`),
    enabled: Boolean(preview?.awakening.awakened && tokenId && indexStatus.data?.caughtUp),
    retry: false,
    refetchInterval: 30_000,
  });
  const actions = useQuery({
    queryKey: ["agent-actions", tokenId],
    queryFn: () => apiFetch<{ actions: AgentAction[] }>(`/agents/tokens/${tokenId}/actions`),
    enabled: Boolean(preview?.awakening.awakened && tokenId && indexStatus.data?.caughtUp),
    refetchInterval: (query) => query.state.data?.actions.some((action) => ["submitted", "unknown"].includes(action.status)) ? 5_000 : false,
    retry: false,
  });

  const signIn = useMutation({
    mutationFn: async () => {
      if (!window.ethereum) throw new Error("Install or open an EVM wallet to continue.");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No wallet account was selected.");
      const challenge = await apiFetch<{ challengeId: string; message: string }>("/wallet/challenge", {
        method: "POST", body: JSON.stringify({ address }),
      });
      const signature = await window.ethereum.request({ method: "personal_sign", params: [challenge.message, address] }) as string;
      await apiFetch("/wallet/verify", {
        method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, message: challenge.message, signature }),
      });
      return address;
    },
    onSuccess: async (address) => {
      setWalletAddress(address);
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-owned"] });
    },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const createMonitor = useMutation({
    mutationFn: () => apiFetch(`/agents/tokens/${tokenId}/monitors`, {
      method: "POST",
      body: JSON.stringify({
        direction: "INCOMING",
        minimumAmount,
        cadence,
        checkpointOnMatch,
        ...(checkpointOnMatch && monitorCheckpointSessionKey ? { checkpointSessionKey: monitorCheckpointSessionKey } : {}),
        ...(cadence === "CONTINUOUS" ? {} : { expectedAmount, nextExpectedAt: new Date(nextExpectedAt).toISOString() }),
      }),
    }),
    onSuccess: async () => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["agent-monitors", tokenId] });
    },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const syncMonitor = useMutation({
    mutationFn: (id: string) => apiFetch(`/agents/tokens/${tokenId}/monitors/${id}/sync`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agent-monitors", tokenId] }),
        queryClient.invalidateQueries({ queryKey: ["agent-notifications"] }),
      ]);
    },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const submitCheckpoint = useMutation({
    mutationFn: (preflight: NonNullable<ReturnType<typeof checkpointNotificationData>>) => apiFetch(`/agents/tokens/${tokenId}/sponsorship/checkpoint/submit`, {
      method: "POST",
      body: JSON.stringify({
        sessionKey: preflight.session!.sessionKey,
        category: preflight.categoryName,
        payloadHash: preflight.payloadHash,
        waitForReceipt: false,
      }),
    }),
    onSuccess: async () => {
      setError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agent-notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-briefing", tokenId] }),
        queryClient.invalidateQueries({ queryKey: ["agent-sponsorship-budget", tokenId] }),
      ]);
    },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const acceptModelConsent = useMutation({
    mutationFn: () => apiFetch(`/agents/tokens/${tokenId}/model-consent`, { method: "POST", body: JSON.stringify({ acknowledgePrivateDataSharing: true }) }),
    onSuccess: async () => { setConsentChecked(false); await queryClient.invalidateQueries({ queryKey: ["agent-model-consent", tokenId] }); },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const revokeModelConsent = useMutation({
    mutationFn: () => apiFetch(`/agents/tokens/${tokenId}/model-consent`, { method: "DELETE" }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["agent-model-consent", tokenId] }); },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const sendChat = useMutation({
    mutationFn: () => apiFetch<{ conversationId: string; userMessage: ConversationMessage; assistantMessage: ConversationMessage }>(`/agents/tokens/${tokenId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: chatText, conversationId: conversationId ?? undefined, sharePrivateContext: true }),
    }),
    onSuccess: async (result) => {
      setConversationId(result.conversationId);
      setChatMessages((current) => [...current, result.userMessage, result.assistantMessage]);
      setChatText("");
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["agent-conversations", tokenId] });
    },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const openConversation = async (id: string) => {
    try {
      const result = await apiFetch<{ conversation: { messages: ConversationMessage[] } }>(`/agents/tokens/${tokenId}/conversations/${id}`);
      setConversationId(id);
      setChatMessages(result.conversation.messages);
      setError("");
    } catch (requestError) { setError((requestError as Error).message); }
  };

  const inspect = useMutation({
    mutationFn: (id: string) => apiFetch<AgentPreview>(`/agents/tokens/${id}/preview`),
    onSuccess: (data) => { setPreview(data); setPreparedAwakening(null); setPreparedControl(null); setSessionState(null); setError(""); },
    onError: (requestError) => { setPreview(null); setError((requestError as Error).message); },
  });

  const prepareAwakening = useMutation({
    mutationFn: () => apiFetch<PreparedAwakening>(`/agents/tokens/${tokenId}/awakening/prepare`, { method: "POST" }),
    onSuccess: (prepared) => { setPreparedAwakening(prepared); setAwakeningTxHash(null); setAwakeningTxStatus("idle"); setError(""); },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const submitAwakening = useMutation({
    mutationFn: async () => {
      if (!window.ethereum || !preparedAwakening || !connectedAddress) throw new Error("Prepare the awakening again.");
      if (preparedAwakening.from.toLowerCase() !== connectedAddress.toLowerCase()) throw new Error("The connected wallet changed. Prepare again.");
      setAwakeningTxStatus("submitted");
      const result = await submitPrepared(window.ethereum, preparedAwakening, setAwakeningTxHash);
      return result;
    },
    onSuccess: async ({ action }) => {
      setPreparedAwakening(null);
      setError("");
      setAwakeningTxStatus(action.status === "confirmed" ? "confirmed" : action.status === "failed" ? "failed" : "unknown");
      if (action.status === "confirmed") inspect.mutate(tokenId);
    },
    onError: (requestError) => { setAwakeningTxStatus("failed"); setError((requestError as Error).message); },
  });

  const prepareControl = useMutation({
    mutationFn: (request: { path: string; body: Record<string, string | boolean> }) => apiFetch<AgentAction>(`/agents/tokens/${tokenId}/controls/${request.path}/prepare`, {
      method: "POST", body: JSON.stringify(request.body),
    }),
    onSuccess: (prepared) => { setPreparedControl(prepared); setControlTxHash(null); setControlTxStatus("idle"); setError(""); },
    onError: (requestError) => setError((requestError as Error).message),
  });

  const submitControl = useMutation({
    mutationFn: async () => {
      if (!window.ethereum || !preparedControl || !connectedAddress) throw new Error("Prepare the action again.");
      if (preparedControl.from.toLowerCase() !== connectedAddress.toLowerCase()) throw new Error("The connected wallet changed. Prepare again.");
      setControlTxStatus("submitted");
      const result = await submitPrepared(window.ethereum, preparedControl, setControlTxHash);
      return result;
    },
    onSuccess: async ({ action }) => {
      setPreparedControl(null);
      setControlTxStatus(action.status);
      setError(action.status === "failed" ? "The agent action failed on Arc." : "");
      await queryClient.invalidateQueries({ queryKey: ["agent-actions", tokenId] });
      if (action.status === "confirmed") inspect.mutate(tokenId);
    },
    onError: (requestError) => { setControlTxStatus("failed"); setError((requestError as Error).message); },
  });

  const inspectSession = useMutation({
    mutationFn: () => apiFetch<CheckpointSessionState>(`/agents/tokens/${tokenId}/controls/sessions/${sessionKey}`),
    onSuccess: (result) => { setSessionState(result); setError(""); },
    onError: (requestError) => { setSessionState(null); setError((requestError as Error).message); },
  });

  const image = useMemo(() => {
    if (!preview?.persona) return undefined;
    return composeMaskbornDataUrl(preview.persona.traits.map((trait) => trait.index) as TraitSelection);
  }, [preview]);
  const smokeChecks = useMemo(() => [
    { label: "Wallet signed in", ok: Boolean(connectedAddress) },
    { label: "Collection configured", ok: Boolean(status.data?.configured) },
    { label: "Ownership index caught up", ok: Boolean(indexStatus.data?.caughtUp) },
    { label: "Token selected", ok: Boolean(preview) },
    { label: "Token awakened", ok: Boolean(preview?.awakening.awakened) },
    { label: "ERC-4337 checkpoint path", ok: Boolean(preview?.awakening.accountState?.erc4337.supported) },
    { label: "Pimlico bundler reachable", ok: Boolean(bundlerStatus.data?.configured && bundlerStatus.data.chainMatches && bundlerStatus.data.entryPointSupported) },
    { label: sponsorshipStatus.data?.enabled ? "Sponsored gas enabled" : "Sponsored gas intentionally off", ok: sponsorshipStatus.data ? !sponsorshipStatus.data.enabled : status.data?.accountAbstraction?.sponsorship === false && bundlerStatus.data?.sponsorship === false },
  ], [bundlerStatus.data, connectedAddress, indexStatus.data?.caughtUp, preview, sponsorshipStatus.data, status.data]);

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{1,5}$/.test(tokenId) || Number(tokenId) < 1 || Number(tokenId) > 10_000) {
      setError("Enter a token ID from 1 to 10,000.");
      return;
    }
    inspect.mutate(tokenId);
  };

  return (
    <section className="agent-lab shell">
      <div className="agent-lab-rail">
        <article className="agent-step-card">
          <span className="agent-step-index">01</span>
          <ShieldCheck size={25} />
          <h2>Prove the wallet</h2>
          <p>A signature proves control. It costs nothing and moves no funds.</p>
          <button className="button button-amber" onClick={() => signIn.mutate()} disabled={signIn.isPending}>
            {signIn.isPending ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />}
            {connectedAddress ? compact(connectedAddress) : "Sign in with wallet"}
          </button>
        </article>

        <article className="agent-step-card">
          <span className="agent-step-index">02</span>
          <CheckCircle2 size={25} />
          <h2>Choose your mask</h2>
          <p>Ownership is checked against {status.data?.network ?? "Arc"} at the latest block.</p>
          <form className="agent-token-form" onSubmit={submitToken}>
            <input value={tokenId} onChange={(event) => setTokenId(event.target.value)} placeholder="Token ID" inputMode="numeric" />
            <button aria-label="Inspect Mask Born" disabled={!connectedAddress || inspect.isPending}>
              {inspect.isPending ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            </button>
          </form>
          {owned.data?.tokenIds.length ? (
            <div className="agent-owned-tokens" aria-label="Owned Mask Born tokens">
              {owned.data.tokenIds.map((id) => <button key={id} onClick={() => { setTokenId(id); inspect.mutate(id); }}>#{id}</button>)}
            </div>
          ) : connectedAddress && !owned.isLoading ? <small>No Mask Born tokens found in this wallet.</small> : null}
        </article>

        <article className="agent-step-card agent-status-card">
          <span className="agent-step-index">03</span>
          <span className={`agent-status-dot ${status.data?.configured ? "ready" : "waiting"}`} />
          <h2>Network status</h2>
          <p>{status.data?.configured
            ? `Collection connected on ${status.data.network}. ${indexStatus.data?.caughtUp ? `Ownership indexed through block ${indexStatus.data.indexedThrough}.` : "Ownership index is catching up."}`
            : "Waiting for the canonical collection deployment address."}</p>
          <small>Phase {status.data?.phase ?? 1} Ã‚Â· {status.data?.accountAbstraction?.bundlerConfigured ? `${status.data.accountAbstraction.bundlerProvider} bundler configured` : "managed bundler pending"}</small>
        </article>
      </div>

      {error && <p className="agent-error" role="alert">{error}</p>}
      <article className="agent-readiness-panel">
        <div>
          <p className="eyebrow">Phase 2 readiness</p>
          <h3>Browser smoke checklist</h3>
          <p>This is the holder-facing proof layer: it confirms the app can see the collection, awakened account, checkpoint-only ERC-4337 path, and configured Pimlico bundler without implying sponsored gas is live.</p>
        </div>
        <div className="agent-readiness-grid">
          {smokeChecks.map((check) => <span key={check.label} className={check.ok ? "ready" : "waiting"}>{check.ok ? "âœ“" : "â€“"} {check.label}</span>)}
        </div>
        <div className="agent-bundler-card">
          <span>Bundler</span>
          <b>{status.data?.accountAbstraction?.bundlerConfigured ? status.data.accountAbstraction.bundlerProvider : "Not configured"}</b>
          <small>{bundlerStatus.isLoading ? "Checking live RPCâ€¦" : bundlerStatus.data ? `chain ${bundlerStatus.data.chainId ?? "unknown"} / EntryPoint ${bundlerStatus.data.entryPointSupported ? "supported" : "unsupported"}` : status.data?.accountAbstraction?.bundlerConfigured ? "Bundler status unavailable" : "Set AGENT_BUNDLER_PROVIDER and RPC URL to enable."}</small>
          <small>Paymaster: {sponsorshipStatus.data?.paymasterProvider ?? status.data?.accountAbstraction?.paymasterProvider ?? "disabled"} Â· sponsorship {sponsorshipStatus.data?.enabled ? "on" : "off"}</small>
          {sponsorshipStatus.data?.eligibleOperations?.length ? <small>Eligible now: {sponsorshipStatus.data.eligibleOperations.join(", ")}</small> : null}
          {sponsorshipStatus.data && <small>Budget rule: {sponsorshipStatus.data.dailyAllowance} {sponsorshipStatus.data.currency} / token / day Â· {sponsorshipStatus.data.dailyTransactionLimit} tx cap Â· {sponsorshipStatus.data.disabledReason ?? "ready"}</small>}
        </div>
      </article>

      {preview && (
        <>
        <div className="agent-profile-panel">
          <PixelArtwork source={image} variant={Number(preview.token.tokenId)} label={`Mask Born #${preview.token.tokenId}`} eager />
          <div className="agent-profile-copy">
            <p className="eyebrow">Verified at block {preview.token.asOfBlock}</p>
            <h2>{preview.persona?.name ?? `Mask Born #${preview.token.tokenId}`}</h2>
            <strong>{preview.persona?.role ?? "Waiting for reveal"}</strong>
            <p>{preview.persona?.summary ?? "Traits remain sealed until the collection reveal."}</p>
            <div className="agent-balance">
              <span>Wallet balance</span>
              <b>{preview.wallet.nativeUsdc === undefined ? "Unavailable" : `${preview.wallet.nativeUsdc} USDC`}</b>
            </div>
            <div className="agent-awakening">
              <p className="eyebrow"><Sparkles size={14} /> Onchain identity</p>
              {!preview.awakening.configured ? (
                <p>The awakening contracts are not deployed in this environment yet.</p>
              ) : preview.awakening.awakened ? (
                <div>
                  <strong>Awakened as ERC-8004 agent #{preview.awakening.agentId}</strong>
                  <p>Its ERC-6551 account is <a href={`https://testnet.arcscan.app/address/${preview.awakening.account}`} target="_blank" rel="noreferrer">{compact(preview.awakening.account!)} <ExternalLink size={12} /></a>.</p>
                </div>
              ) : !preparedAwakening ? (
                <div>
                  <p>One wallet-confirmed transaction creates the account and registers the identity. The NFT and art do not change.</p>
                  <button className="button button-amber" onClick={() => prepareAwakening.mutate()} disabled={!preview.persona || prepareAwakening.isPending}>
                    {prepareAwakening.isPending ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Prepare awakening
                  </button>
                </div>
              ) : (
                <div className="agent-awakening-review">
                  <strong>Review before wallet confirmation</strong>
                  <span>Network <b>{status.data?.network}</b></span>
                  <span>Creates account <b>{compact(preparedAwakening.predictedAccount)}</b></span>
                  <span>Value <b>0 USDC</b></span>
                  <span>Estimated gas <b>{preparedAwakening.gasEstimate}</b></span>
                  <button className="button button-amber" onClick={() => submitAwakening.mutate()} disabled={submitAwakening.isPending}>
                    {submitAwakening.isPending ? <LoaderCircle className="spin" size={16} /> : <Wallet size={16} />} Confirm in wallet
                  </button>
                  <button className="agent-revoke-consent" onClick={() => setPreparedAwakening(null)}>Cancel</button>
                </div>
              )}
              {awakeningTxHash && <p>{awakeningTxStatus === "submitted" ? "Submitted; waiting for confirmation" : awakeningTxStatus === "confirmed" ? "Confirmed on Arc" : awakeningTxStatus === "unknown" ? "Confirmation timed out; check Arcscan before retrying" : "Transaction failed"}: <a href={`https://testnet.arcscan.app/tx/${awakeningTxHash}`} target="_blank" rel="noreferrer">view transaction <ExternalLink size={12} /></a>.</p>}
            </div>
            {preview.persona && <div className="agent-traits">
              {preview.persona.traits.map((trait) => <span key={trait.category}>{trait.category}: <b>{trait.name}</b></span>)}
            </div>}
          </div>
          <div className="agent-capabilities">
            <p className="eyebrow">Capability ledger</p>
            {preview.capabilities.map((capability) => (
              <div key={capability.id}><span>{capability.label}</span><small>{capability.status.replaceAll("_", " ")}</small></div>
            ))}
          </div>
        </div>
        {preview.awakening.awakened && preview.awakening.accountState && (
          <article className="agent-control-panel">
            <div className="agent-control-heading">
              <div>
                <p className="eyebrow">Owner-confirmed controls</p>
                <h3>Agent account</h3>
                <p>Every change is simulated, shown for review, and only sent after your wallet confirms it.</p>
              </div>
              <div className="agent-account-stack">
                <div className="agent-account-balance">
                  <span>Account balance</span>
                  <b>{preview.awakening.accountState.nativeUsdc} USDC</b>
                  <small>{preview.awakening.accountState.executionPaused ? "Execution paused" : "Execution active"}</small>
                </div>
                <div className="agent-account-balance agent-sponsor-budget">
                  <span>Sponsored gas</span>
                  <b>{sponsorshipBudget.data ? `${sponsorshipBudget.data.policy.dailyAllowance} ${sponsorshipBudget.data.policy.currency}` : sponsorshipStatus.data ? `${sponsorshipStatus.data.dailyAllowance} ${sponsorshipStatus.data.currency}` : "0.25 USDC"}</b>
                  {sponsorshipBudget.data?.policy.eligibleOperations?.length ? <small>Eligible: {sponsorshipBudget.data.policy.eligibleOperations.join(", ")}</small> : null}
                  <small>{sponsorshipBudget.data ? `${sponsorshipBudget.data.remainingTransactions} tx left today Â· sponsorship ${sponsorshipBudget.data.policy.enabled ? "on" : "off"}` : indexStatus.data?.caughtUp ? "Budget loading" : "Budget unlocks after index catch-up"}</small>
                </div>
              </div>
            </div>

            {!preparedControl ? (
              <div className="agent-control-grid">
                <div>
                  <strong>Emergency execution switch</strong>
                  <p>Pause outgoing account execution immediately. URI recovery remains available.</p>
                  <button className="button button-amber" disabled={prepareControl.isPending} onClick={() => prepareControl.mutate({ path: "pause", body: { paused: !preview.awakening.accountState!.executionPaused } })}>
                    {preview.awakening.accountState.executionPaused ? "Prepare unpause" : "Prepare pause"}
                  </button>
                </div>
                <div>
                  <strong>Public agent URI</strong>
                  <p>Point the identity at a permanent HTTPS, IPFS, or data URI.</p>
                  <input value={agentURI} onChange={(event) => setAgentURI(event.target.value)} placeholder="https://example.com/agent.json" />
                  <button className="button button-amber" disabled={!agentURI.trim() || prepareControl.isPending} onClick={() => prepareControl.mutate({ path: "uri", body: { agentURI: agentURI.trim() } })}>Prepare URI update</button>
                </div>
                <div>
                  <strong>Send native USDC</strong>
                  <p>Transfer from the token-bound account. The transaction itself sends 0 USDC to the contract.</p>
                  <input value={sendRecipient} onChange={(event) => setSendRecipient(event.target.value)} placeholder="Recipient 0xÃ¢â‚¬Â¦" />
                  <input value={sendAmount} onChange={(event) => setSendAmount(event.target.value)} placeholder="Amount in USDC" inputMode="decimal" />
                  <button className="button button-amber" disabled={!sendRecipient || !sendAmount || prepareControl.isPending || preview.awakening.accountState.executionPaused} onClick={() => prepareControl.mutate({ path: "send", body: { recipient: sendRecipient, amount: sendAmount } })}>Prepare transfer</button>
                </div>
              </div>
            ) : (
              <div className="agent-control-review">
                <p className="eyebrow">Review before wallet confirmation</p>
                <strong>{preparedControl.type.replaceAll("_", " ").toLowerCase()}</strong>
                <span>Network <b>{status.data?.network}</b></span>
                <span>Account <b>{compact(preparedControl.account)}</b></span>
                {Object.entries(preparedControl.payload).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")} <b>{String(value)}</b></span>)}
                <span>Transaction value <b>0 USDC</b></span>
                <span>Estimated gas <b>{preparedControl.gasEstimate}</b></span>
                <div>
                  <button className="button button-amber" onClick={() => submitControl.mutate()} disabled={submitControl.isPending}>{submitControl.isPending ? <LoaderCircle className="spin" size={16} /> : <Wallet size={16} />} Confirm in wallet</button>
                  <button className="agent-revoke-consent" onClick={() => setPreparedControl(null)}>Cancel</button>
                </div>
              </div>
            )}

            {preview.awakening.accountState.checkpointSessions.supported && !preparedControl && (
              <div className="agent-session-panel">
                <div>
                  <p className="eyebrow">Bounded checkpoint session</p>
                  <h4>Let the runtime prove work, never spend</h4>
                  <p>This key can only publish monitor-observation, report-digest, or liveness hashes. It cannot call another contract, transfer USDC, update the identity, or change permissions.</p>
                </div>
                <div className="agent-session-form">
                  <label>Session-key EOA address<input value={sessionKey} onChange={(event) => { setSessionKey(event.target.value); setSessionState(null); }} placeholder="Separate signer 0x address" /></label>
                  <label>Lifetime in hours<input value={sessionHours} onChange={(event) => setSessionHours(event.target.value)} inputMode="numeric" /></label>
                  <label>Maximum checkpoints<input value={sessionMaxCalls} onChange={(event) => setSessionMaxCalls(event.target.value)} inputMode="numeric" /></label>
                  <div>
                    <button className="button button-amber" disabled={!sessionKey || prepareControl.isPending} onClick={() => prepareControl.mutate({ path: "sessions/grant", body: { sessionKey, durationHours: sessionHours, maxCalls: sessionMaxCalls } })}>Prepare grant</button>
                    <button className="agent-revoke-consent" disabled={!sessionKey || prepareControl.isPending} onClick={() => prepareControl.mutate({ path: "sessions/revoke", body: { sessionKey } })}>Prepare revoke</button>
                    <button className="agent-revoke-consent" disabled={!sessionKey || inspectSession.isPending} onClick={() => inspectSession.mutate()}>Inspect key</button>
                  </div>
                </div>
                {sessionState && (
                  <div className="agent-session-state">
                    <strong>{sessionState.active ? "Active" : sessionState.revoked ? "Revoked" : "Inactive"}</strong>
                    <span>Owner <b>{sessionState.authorizedOwner ? compact(sessionState.authorizedOwner) : "None"}</b></span>
                    <span>Calls <b>{sessionState.calls} / {sessionState.maxCalls}</b></span>
                    <span>Expires <b>{sessionState.validUntil === "0" ? "Never granted" : new Date(Number(sessionState.validUntil) * 1000).toLocaleString()}</b></span>
                    <small>Verified at Arc block {sessionState.asOfBlock}</small>
                  </div>
                )}
                <small>A transfer to a different owner disables the key. Because the original NFT has no transfer hook, buyers should still revoke visible sessions before funding the account.</small>
                {preview.awakening.accountState.erc4337.supported && (
                  <small>ERC-4337 v{preview.awakening.accountState.erc4337.version}: checkpoint-only UserOperations are supported through EntryPoint {compact(preview.awakening.accountState.erc4337.entryPoint!)}. Managed bundler: {preview.awakening.accountState.erc4337.bundlerConfigured ? preview.awakening.accountState.erc4337.bundlerProvider : "not configured"}. Gas sponsorship is not enabled yet.</small>
                )}
              </div>
            )}

            {controlTxHash && <p className="agent-control-result">{controlTxStatus.replaceAll("_", " ")}: <a href={`https://testnet.arcscan.app/tx/${controlTxHash}`} target="_blank" rel="noreferrer">view transaction <ExternalLink size={12} /></a></p>}
            <div className="agent-action-history">
              <p className="eyebrow">Current holder history</p>
              {actions.data?.actions.map((action) => <div key={action.id}><span>{action.type.replaceAll("_", " ").toLowerCase()}</span><small className={`agent-action-${action.status}`}>{action.status}</small>{action.txHash && <a href={`https://testnet.arcscan.app/tx/${action.txHash}`} target="_blank" rel="noreferrer">Arcscan <ExternalLink size={11} /></a>}</div>)}
              {!actions.isLoading && !actions.data?.actions.length && <small>No account actions in this ownership period.</small>}
            </div>
          </article>
        )}
        <div className="agent-utility-grid">
          <article className="agent-utility-card">
            <p className="eyebrow">Agent briefing</p>
            <h3>Today at a glance</h3>
            {briefing.data ? (
              <>
                <p>{briefing.data.monitoring.activeRules} active monitor{briefing.data.monitoring.activeRules === 1 ? "" : "s"} · {briefing.data.monitoring.checkpointReady} checkpoint-ready alert{briefing.data.monitoring.checkpointReady === 1 ? "" : "s"}.</p>
                <p>Sponsored gas: {briefing.data.sponsorship.enabled ? "enabled" : briefing.data.sponsorship.disabledReason ?? "off"}{briefing.data.sponsorship.remainingUsdc ? ` · ${briefing.data.sponsorship.remainingUsdc} USDC left` : ""}.</p>
                <p>Submitter: {briefing.data.checkpointSubmitter.configured ? "session key configured" : "no session key configured"} · autosubmit {briefing.data.checkpointSubmitter.autosubmit ? "on" : "off"}.</p>
                <ul className="agent-briefing-list">
                  {briefing.data.suggestions.slice(0, 3).map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
                  {!briefing.data.suggestions.length && <li>No urgent setup suggestion right now.</li>}
                </ul>
              </>
            ) : <small>{indexStatus.data?.caughtUp ? "Loading briefing" : "Briefing unlocks after ownership index catch-up."}</small>}
          </article>
          <article className="agent-utility-card">
            <p className="eyebrow">USDC stream monitor</p>
            <h3>Watch incoming payments</h3>
            <label>Minimum payment<input value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value)} inputMode="decimal" /></label>
            <label>Schedule<select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}><option value="CONTINUOUS">Every payment</option><option value="DAILY">Expected daily</option><option value="WEEKLY">Expected weekly</option></select></label>
            {cadence !== "CONTINUOUS" && <>
              <label>Expected USDC<input value={expectedAmount} onChange={(event) => setExpectedAmount(event.target.value)} inputMode="decimal" /></label>
              <label>Next due<input type="datetime-local" value={nextExpectedAt} onChange={(event) => setNextExpectedAt(event.target.value)} /></label>
            </>}
            <label className="agent-checkbox-row"><input type="checkbox" checked={checkpointOnMatch} onChange={(event) => setCheckpointOnMatch(event.target.checked)} /> Prepare onchain checkpoint when a match is found</label>
            {checkpointOnMatch && <label>Checkpoint session key<input value={monitorCheckpointSessionKey} onChange={(event) => setMonitorCheckpointSessionKey(event.target.value)} placeholder="0x..." /></label>}
            <button className="button button-amber" onClick={() => createMonitor.mutate()} disabled={createMonitor.isPending || (cadence !== "CONTINUOUS" && (!expectedAmount || !nextExpectedAt))}>Create monitor</button>
            <div className="agent-monitor-list">
              {monitors.data?.rules.filter((rule) => rule.isActive).map((rule) => <div key={rule.id}><span>{rule.cadence.toLowerCase()} Ã‚Â· Ã¢â€°Â¥ {rule.minimumAmount} USDC{rule.checkpointOnMatch ? " · checkpoint preflight" : ""}</span><button onClick={() => syncMonitor.mutate(rule.id)} disabled={syncMonitor.isPending}><RefreshCw size={14} /> Sync</button></div>)}
              {!monitors.isLoading && !monitors.data?.rules.some((rule) => rule.isActive) && <small>No active monitors.</small>}
            </div>
          </article>
          <article className="agent-utility-card">
            <p className="eyebrow"><Bell size={14} /> Inbox</p>
            <h3>Payment activity</h3>
            <div className="agent-inbox">
              {notifications.data?.notifications.map((notification) => {
                const checkpoint = checkpointNotificationData(notification);
                return (
                  <div key={notification.id} className={notification.readAt ? "read" : ""}>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    {checkpoint && (
                      <div className="agent-checkpoint-details">
                        <small>Payload: {compact(checkpoint.payloadHash!)}</small>
                        <small>Session: {compact(checkpoint.session!.sessionKey!)}</small>
                        <small>Nonce: {checkpoint.nonce ?? "unknown"} · {checkpoint.canSponsor ? "sponsor-ready" : checkpoint.blockers?.join(", ") ?? "sponsorship off"}</small>
                        {checkpoint.userOperationHash ? (
                          <a href={`https://testnet.arcscan.app/userOp/${checkpoint.userOperationHash}`} target="_blank" rel="noreferrer">submitted UserOp <ExternalLink size={11} /></a>
                        ) : (
                          <button className="button button-ghost" onClick={() => submitCheckpoint.mutate(checkpoint)} disabled={submitCheckpoint.isPending}>Submit checkpoint</button>
                        )}
                      </div>
                    )}
                    <small>{new Date(notification.createdAt).toLocaleString()}</small>
                  </div>
                );
              })}
              {!notifications.isLoading && !notifications.data?.notifications.length && <small>No payment alerts yet.</small>}
            </div>
          </article>
          <article className="agent-utility-card agent-chat-card">
            <p className="eyebrow"><MessageSquare size={14} /> Read-only assistant</p>
            {!chatStatus.data?.configured ? <p>The model provider is not configured. Wallet reads and monitoring continue without it.</p> : !indexStatus.data?.caughtUp ? <p>Private chat unlocks after the ownership index catches up.</p> : !modelConsent.data?.consented ? <div className="agent-consent">
              <h3>Choose whether to share private context</h3>
              <p>Each request goes to <b>{chatStatus.data.destinationOrigin}</b> using <b>{chatStatus.data.model}</b>. It may include:</p>
              <ul>{chatStatus.data.sharedFields.map((field) => <li key={field}>{field}</li>)}</ul>
              <label className="agent-consent-check"><input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} /> I understand and authorize this data sharing for the current ownership period.</label>
              <button className="button button-amber" disabled={!consentChecked || acceptModelConsent.isPending} onClick={() => acceptModelConsent.mutate()}>Enable assistant</button>
            </div> : <div className="agent-chat-shell">
              <div className="agent-conversation-list">
                <button onClick={() => { setConversationId(null); setChatMessages([]); }}>+ New conversation</button>
                {conversations.data?.conversations.map((conversation) => <button key={conversation.id} onClick={() => void openConversation(conversation.id)}>{conversation.title ?? "Conversation"}</button>)}
              </div>
              <div className="agent-chat-main">
                <div className="agent-chat-messages">
                  {chatMessages.map((message) => <div key={message.id} className={message.role.toLowerCase()}><small>{message.role === "USER" ? "You" : preview.persona?.name ?? "Mask Born"}</small><p>{message.content}</p></div>)}
                  {!chatMessages.length && <p className="agent-chat-empty">Ask about traits, balances, recent USDC activity, monitors, or Payday status.</p>}
                </div>
                <form onSubmit={(event) => { event.preventDefault(); if (chatText.trim()) sendChat.mutate(); }}><textarea value={chatText} onChange={(event) => setChatText(event.target.value)} maxLength={2000} placeholder="Ask your Mask BornÃ¢â‚¬Â¦" /><button className="button button-amber" disabled={!chatText.trim() || sendChat.isPending}>{sendChat.isPending ? <LoaderCircle className="spin" size={16} /> : "Send"}</button></form>
                <button className="agent-revoke-consent" onClick={() => revokeModelConsent.mutate()}>Revoke model data access</button>
              </div>
            </div>}
          </article>
        </div>
        </>
      )}
    </section>
  );
}


