"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type CurrentUser = {
  id: string;
  role: "USER" | "ADMIN";
  displayName: string | null;
  avatarUrl: string | null;
  socialAccounts: Array<{ provider: "X_MANUAL" | "DISCORD"; username: string; verificationState: string }>;
  wallets: Array<{ id: string; chain: "EVM" | "SOLANA"; address: string; isPrimary: boolean; verifiedAt: string | null }>;
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await apiFetch<{ user: CurrentUser }>("/session");
      } catch (error) {
        if ((error as Error & { status?: number }).status === 401) return { user: null };
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
