import { config } from "../../config.js";

const ENTRY_POINT_V09 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";

type JsonRpcSuccess<T> = { jsonrpc: "2.0"; id: number; result: T };
type JsonRpcFailure = { jsonrpc: "2.0"; id: number | null; error: { code: number; message: string; data?: unknown } };

type BundlerStatus = {
  configured: boolean;
  provider: typeof config.AGENT_BUNDLER_PROVIDER;
  chainId: number | null;
  expectedChainId: number;
  chainMatches: boolean;
  entryPoint: string;
  supportedEntryPoints: string[];
  entryPointSupported: boolean;
  paymasterProvider: typeof config.AGENT_PAYMASTER_PROVIDER;
  sponsorship: false;
};

export const erc4337EntryPoint = ENTRY_POINT_V09;

export async function readBundlerStatus(): Promise<BundlerStatus> {
  const base = {
    configured: config.AGENT_BUNDLER_PROVIDER !== "disabled" && Boolean(config.AGENT_BUNDLER_RPC_URL),
    provider: config.AGENT_BUNDLER_PROVIDER,
    expectedChainId: config.ARC_CHAIN_ID,
    entryPoint: ENTRY_POINT_V09,
    paymasterProvider: config.AGENT_PAYMASTER_PROVIDER,
    sponsorship: false as const,
  };
  if (!base.configured) {
    return { ...base, chainId: null, chainMatches: false, supportedEntryPoints: [], entryPointSupported: false };
  }

  const [chainIdHex, supportedEntryPoints] = await Promise.all([
    bundlerRequest<string>("eth_chainId", []),
    bundlerRequest<string[]>("eth_supportedEntryPoints", []),
  ]);
  const chainId = Number.parseInt(chainIdHex, 16);
  const normalizedEntryPoints = supportedEntryPoints.map((entryPoint) => entryPoint.toLowerCase());
  return {
    ...base,
    chainId,
    chainMatches: chainId === config.ARC_CHAIN_ID,
    supportedEntryPoints,
    entryPointSupported: normalizedEntryPoints.includes(ENTRY_POINT_V09.toLowerCase()),
  };
}

export async function bundlerRequest<T>(method: string, params: unknown[]): Promise<T> {
  if (!config.AGENT_BUNDLER_RPC_URL) throw new Error("Bundler RPC URL is not configured.");
  const response = await fetch(config.AGENT_BUNDLER_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Bundler HTTP ${response.status}`);
  const payload = await response.json() as JsonRpcSuccess<T> | JsonRpcFailure;
  if ("error" in payload) throw new Error(`Bundler ${method} failed: ${payload.error.message}`);
  return payload.result;
}
export type UserOperationRpc = {
  sender: string;
  nonce: string;
  factory?: string;
  factoryData?: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymaster?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterData?: string;
  signature: string;
};

export async function sendUserOperation(userOperation: UserOperationRpc) {
  return bundlerRequest<string>("eth_sendUserOperation", [userOperation, ENTRY_POINT_V09]);
}

export async function getUserOperationReceipt(userOperationHash: string) {
  return bundlerRequest<unknown | null>("eth_getUserOperationReceipt", [userOperationHash]);
}
