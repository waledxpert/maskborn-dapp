import type { Metadata } from "next";
import { PageIntro } from "@/components/page-intro";
import { PaydayDashboard } from "@/components/payday-dashboard";

export const metadata: Metadata = { title: "Payday" };

export default function PaydayPage() {
  return (
    <>
      <PageIntro index="07" eyebrow="USDC accounting" title="Revenue you can verify." copy="See what exists, what is only planned, and which balances belong to creator obligations rather than future holder rewards." />
      <PaydayDashboard />
    </>
  );
}
