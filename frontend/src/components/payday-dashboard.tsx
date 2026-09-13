"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, ExternalLink, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/use-current-user";
import { apiFetch } from "@/lib/api";

type PaydayStatus = {
  network: string;
  deployment: "NOT_DEPLOYED";
  reason: string;
  accountingBoundary: string;
};
type MoneyRecord = { currency: string; symbol: string | null; decimals: number | null; amountBaseUnits: string; displayAmount: string | null };
type CreatorRevenue = {
  status: "TRACKED" | "NO_RECORDED_ACCRUALS";
  activeFeeShares: Array<{ id: string; basisPoints: number; title: string; slug: string }>;
  totals: Array<MoneyRecord & { status: string }>;
  recentAccruals: Array<MoneyRecord & { id: string; status: string; title: string; slug: string; txHash: string; blockNumber: string }>;
  payouts: Array<MoneyRecord & { id: string; status: string; txHash: string | null; createdAt: string }>;
  notice: string;
};

function money(value: MoneyRecord) {
  if (value.displayAmount !== null) return `${value.displayAmount} ${value.symbol ?? value.currency}`;
  return `${value.amountBaseUnits} base units`;
}

export function PaydayDashboard() {
  const session = useCurrentUser();
  const verifiedWallet = session.data?.user?.wallets.find((wallet) => wallet.chain === "EVM" && wallet.verifiedAt);
  const status = useQuery({ queryKey: ["payday-status"], queryFn: () => apiFetch<PaydayStatus>("/payday/status") });
  const holder = useQuery({
    queryKey: ["payday-me", verifiedWallet?.id],
    queryFn: () => apiFetch<{ payday: PaydayStatus; creatorRevenue: CreatorRevenue }>("/payday/me"),
    enabled: Boolean(verifiedWallet),
    retry: false,
  });
  const creator = holder.data?.creatorRevenue;

  return (
    <section className="payday-shell shell">
      <div className="payday-status-grid">
        <article className="payday-primary-card">
          <CircleDollarSign size={28} />
          <p className="eyebrow">Token-holder Payday</p>
          <h2>Not deployed</h2>
          <p>{status.data?.reason ?? "Checking the Arc deployment status…"}</p>
          <div className="payday-null-ledger">
            <div><span>Vault</span><b>Not deployed</b></div>
            <div><span>Enrollment</span><b>Unavailable</b></div>
            <div><span>Claimable</span><b>—</b></div>
            <div><span>Estimate</span><b>—</b></div>
          </div>
        </article>
        <article className="payday-boundary-card">
          <ShieldCheck size={24} />
          <p className="eyebrow">Accounting boundary</p>
          <h3>No imaginary yield</h3>
          <p>{status.data?.accountingBoundary}</p>
          <p>A vault balance will not become claimable until the future contract has allocated a completed epoch.</p>
          <Link href="/agents">Open agent workspace <ExternalLink size={14} /></Link>
        </article>
      </div>

      {!verifiedWallet ? <div className="payday-connect-card">
        <WalletCards size={25} />
        <h3>Sign in with your holder wallet</h3>
        <p>Creator records and future token-specific Payday details are private.</p>
        <Link className="button button-amber" href="/agents">Connect on Agents</Link>
      </div> : <>
        <div className="payday-section-head"><div><p className="eyebrow">Separate ledger</p><h2>Creator revenue</h2></div><p>{creator?.notice}</p></div>
        <div className="payday-totals">
          {creator?.totals.map((total) => <article key={`${total.currency}:${total.status}`}><span>{total.status.toLowerCase()}</span><b>{money(total)}</b>{total.decimals === null && <small>Currency scale was not recorded; no display value is guessed.</small>}</article>)}
          {!holder.isLoading && !creator?.totals.length && <article><span>Recorded accruals</span><b>None</b><small>No creator fee accrual has been written for this wallet.</small></article>}
        </div>
        <div className="payday-ledger-grid">
          <article>
            <p className="eyebrow">Eligible work</p><h3>Active fee shares</h3>
            {creator?.activeFeeShares.map((share) => <Link key={share.id} href={`/art/${share.slug}`}><span>{share.title}</span><b>{share.basisPoints / 100}%</b></Link>)}
            {!creator?.activeFeeShares.length && <p>No active creator fee shares.</p>}
          </article>
          <article>
            <p className="eyebrow">Recent records</p><h3>Accruals and payouts</h3>
            {creator?.recentAccruals.slice(0, 8).map((entry) => <div key={entry.id}><span>{entry.title} · {entry.status.toLowerCase()}</span><b>{money(entry)}</b></div>)}
            {creator?.payouts.slice(0, 5).map((entry) => <div key={entry.id}><span>Payout · {entry.status.toLowerCase()}</span><b>{money(entry)}</b></div>)}
            {!creator?.recentAccruals.length && !creator?.payouts.length && <p>No revenue events or payouts recorded.</p>}
          </article>
        </div>
      </>}
    </section>
  );
}
