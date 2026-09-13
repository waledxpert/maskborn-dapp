import type { Metadata } from "next";
import { AgentsWorkspace } from "@/components/agents-workspace";
import { PageIntro } from "@/components/page-intro";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <>
      <PageIntro
        index="06"
        eyebrow="Agent lab"
        title="Meet the mind behind the mask."
        copy="Prove ownership, preview your Mask Born persona, and inspect live Arc data. Onchain awakening arrives in the next release."
      />
      <AgentsWorkspace />
    </>
  );
}
