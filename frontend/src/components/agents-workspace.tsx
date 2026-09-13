"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, CheckCircle2, LoaderCircle, MessageSquare, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { composeMaskbornDataUrl, type TraitSelection } from "@/lib/maskborn-renderer";
import { PixelArtwork } from "@/components/pixel-artwork";
import { useCurrentUser } from "@/hooks/use-current-user";

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type AgentStatus = { configured: boolean; network: string; chainId: number; collectionAddress: string | null; phase: number };
type AgentIndexStatus = { configured: boolean; latestBlock?: string; indexedThrough?: string | null; caughtUp?: boolean; lastError?: string | null };
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
  capabilities: Array<{ id: string; label: string; status: string }>;
};
type OwnedTokens = { tokenIds: string[]; asOfBlock: string };
type MonitorRule = {
  id: string; direction: "INCOMING" | "OUTGOING" | "BOTH"; minimumAmount: string;
  expectedAmount: string | null; cadence: "CONTINUOUS" | "DAILY" | "WEEKLY";
  nextExpectedAt: string | null; isActive: boolean; lastCheckedAt: string | null;
};
type AgentNotification = {
  id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string;
};
type ChatStatus = { configured: boolean; provider: string; model: string | null; destinationOrigin: string | null; dailyRequestLimit: number; readOnly: boolean; sharedFields: string[] };
type ModelConsent = { consented: boolean; provider: ChatStatus; sharedFields: string[] };
type ConversationSummary = { id: string; title: string | null; updatedAt: string };
type ConversationMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; createdAt: string };

declare global { interface Window { ethereum?: EthereumProvider } }

function compact(address: string) { return `${address.slice(0, 7)}…${address.slice(-5)}`; }

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
  const [chatText, setChatText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
  const [consentChecked, setConsentChecked] = useState(false);
  const status = useQuery({ queryKey: ["agent-status"], queryFn: () => apiFetch<AgentStatus>("/agents/status") });
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
    onSuccess: (data) => { setPreview(data); setError(""); },
    onError: (requestError) => { setPreview(null); setError((requestError as Error).message); },
  });

  const image = useMemo(() => {
    if (!preview?.persona) return undefined;
    return composeMaskbornDataUrl(preview.persona.traits.map((trait) => trait.index) as TraitSelection);
  }, [preview]);

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
          <small>Phase {status.data?.phase ?? 1} · awakening preview</small>
        </article>
      </div>

      {error && <p className="agent-error" role="alert">{error}</p>}

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
        <div className="agent-utility-grid">
          <article className="agent-utility-card">
            <p className="eyebrow">USDC stream monitor</p>
            <h3>Watch incoming payments</h3>
            <label>Minimum payment<input value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value)} inputMode="decimal" /></label>
            <label>Schedule<select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}><option value="CONTINUOUS">Every payment</option><option value="DAILY">Expected daily</option><option value="WEEKLY">Expected weekly</option></select></label>
            {cadence !== "CONTINUOUS" && <>
              <label>Expected USDC<input value={expectedAmount} onChange={(event) => setExpectedAmount(event.target.value)} inputMode="decimal" /></label>
              <label>Next due<input type="datetime-local" value={nextExpectedAt} onChange={(event) => setNextExpectedAt(event.target.value)} /></label>
            </>}
            <button className="button button-amber" onClick={() => createMonitor.mutate()} disabled={createMonitor.isPending || (cadence !== "CONTINUOUS" && (!expectedAmount || !nextExpectedAt))}>Create monitor</button>
            <div className="agent-monitor-list">
              {monitors.data?.rules.filter((rule) => rule.isActive).map((rule) => <div key={rule.id}><span>{rule.cadence.toLowerCase()} · ≥ {rule.minimumAmount} USDC</span><button onClick={() => syncMonitor.mutate(rule.id)} disabled={syncMonitor.isPending}><RefreshCw size={14} /> Sync</button></div>)}
              {!monitors.isLoading && !monitors.data?.rules.some((rule) => rule.isActive) && <small>No active monitors.</small>}
            </div>
          </article>
          <article className="agent-utility-card">
            <p className="eyebrow"><Bell size={14} /> Inbox</p>
            <h3>Payment activity</h3>
            <div className="agent-inbox">
              {notifications.data?.notifications.map((notification) => <div key={notification.id} className={notification.readAt ? "read" : ""}><strong>{notification.title}</strong><p>{notification.body}</p><small>{new Date(notification.createdAt).toLocaleString()}</small></div>)}
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
                <form onSubmit={(event) => { event.preventDefault(); if (chatText.trim()) sendChat.mutate(); }}><textarea value={chatText} onChange={(event) => setChatText(event.target.value)} maxLength={2000} placeholder="Ask your Mask Born…" /><button className="button button-amber" disabled={!chatText.trim() || sendChat.isPending}>{sendChat.isPending ? <LoaderCircle className="spin" size={16} /> : "Send"}</button></form>
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
