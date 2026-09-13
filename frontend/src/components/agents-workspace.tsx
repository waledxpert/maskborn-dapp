"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck, Wallet } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { composeMaskbornDataUrl, type TraitSelection } from "@/lib/maskborn-renderer";
import { PixelArtwork } from "@/components/pixel-artwork";
import { useCurrentUser } from "@/hooks/use-current-user";

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type AgentStatus = { configured: boolean; network: string; chainId: number; collectionAddress: string | null; phase: number };
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

declare global { interface Window { ethereum?: EthereumProvider } }

function compact(address: string) { return `${address.slice(0, 7)}…${address.slice(-5)}`; }

export function AgentsWorkspace() {
  const queryClient = useQueryClient();
  const session = useCurrentUser();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState("");
  const [preview, setPreview] = useState<AgentPreview | null>(null);
  const [error, setError] = useState("");
  const status = useQuery({ queryKey: ["agent-status"], queryFn: () => apiFetch<AgentStatus>("/agents/status") });
  const connectedAddress = walletAddress ?? session.data?.user?.wallets.find(
    (wallet) => wallet.chain === "EVM" && wallet.verifiedAt,
  )?.address ?? null;

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
    },
    onError: (requestError) => setError((requestError as Error).message),
  });

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
        </article>

        <article className="agent-step-card agent-status-card">
          <span className="agent-step-index">03</span>
          <span className={`agent-status-dot ${status.data?.configured ? "ready" : "waiting"}`} />
          <h2>Network status</h2>
          <p>{status.data?.configured
            ? `Collection connected on ${status.data.network}.`
            : "Waiting for the canonical collection deployment address."}</p>
          <small>Phase {status.data?.phase ?? 1} · awakening preview</small>
        </article>
      </div>

      {error && <p className="agent-error" role="alert">{error}</p>}

      {preview && (
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
      )}
    </section>
  );
}
