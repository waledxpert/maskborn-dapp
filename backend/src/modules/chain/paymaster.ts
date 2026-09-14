import { config } from "../../config.js";
import { erc4337EntryPoint, type UserOperationRpc } from "./bundler.js";

type JsonRpcSuccess<T> = { jsonrpc: "2.0"; id: number; result: T };
type JsonRpcFailure = { jsonrpc: "2.0"; id: number | null; error: { code: number; message: string; data?: unknown } };

export type PaymasterSponsorResult = {
  callGasLimit?: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
  paymaster: string;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
  paymasterData: string;
};

export function readPaymasterStatus() {
  const configured = config.AGENT_PAYMASTER_PROVIDER !== "disabled" && Boolean(config.AGENT_PAYMASTER_RPC_URL);
  return {
    configured,
    provider: config.AGENT_PAYMASTER_PROVIDER,
    policyConfigured: Boolean(config.AGENT_PAYMASTER_POLICY_ID),
    entryPoint: erc4337EntryPoint,
    rpcConfigured: Boolean(config.AGENT_PAYMASTER_RPC_URL),
  };
}

export async function sponsorUserOperation(userOperation: UserOperationRpc): Promise<PaymasterSponsorResult> {
  if (!config.AGENT_PAYMASTER_RPC_URL) throw new Error("Paymaster RPC URL is not configured.");
  const sponsorshipOptions = config.AGENT_PAYMASTER_POLICY_ID ? { sponsorshipPolicyId: config.AGENT_PAYMASTER_POLICY_ID } : undefined;
  const params = sponsorshipOptions ? [userOperation, erc4337EntryPoint, sponsorshipOptions] : [userOperation, erc4337EntryPoint];
  return paymasterRequest<PaymasterSponsorResult>("pm_sponsorUserOperation", params);
}

async function paymasterRequest<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(config.AGENT_PAYMASTER_RPC_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Paymaster HTTP ${response.status}`);
  const payload = await response.json() as JsonRpcSuccess<T> | JsonRpcFailure;
  if ("error" in payload) throw new Error(`Paymaster ${method} failed: ${payload.error.message}`);
  return payload.result;
}