import { parseAbi, toBytes, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../../config.js";
import { ApiError } from "../../errors.js";
import { arcClient } from "../chain/client.js";
import { bundlerRequest, erc4337EntryPoint, getUserOperationReceipt, sendUserOperation, type UserOperationRpc } from "../chain/bundler.js";
import { preflightCheckpointSponsorship, type CheckpointCategoryName } from "./checkpoint-preflight.js";
import type { ActionAuth } from "./actions.js";

const entryPointAbi = parseAbi([
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
]);
const verificationGasLimit = 500_000n;
const callGasLimit = 250_000n;
const preVerificationGas = 100_000n;

function pack128(high: bigint, low: bigint) {
  return toHex((high << 128n) | low, { size: 32 });
}

async function selectedGasFees() {
  const gasPrice = await bundlerRequest<{ fast?: { maxFeePerGas: string; maxPriorityFeePerGas: string }; standard?: { maxFeePerGas: string; maxPriorityFeePerGas: string } }>("pimlico_getUserOperationGasPrice", []).catch(() => null);
  const selected = gasPrice?.fast ?? gasPrice?.standard;
  return {
    maxFeePerGas: selected ? BigInt(selected.maxFeePerGas) : 60_000_000_000n,
    maxPriorityFeePerGas: selected ? BigInt(selected.maxPriorityFeePerGas) : 2_000_000_000n,
  };
}

async function waitForUserOpReceipt(userOpHash: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const receipt = await getUserOperationReceipt(userOpHash);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}

export function readCheckpointSubmitterStatus() {
  const signer = config.AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY ? privateKeyToAccount(config.AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY as Hex) : null;
  return {
    configured: Boolean(signer),
    signerAddress: signer?.address ?? null,
    autosubmit: config.AGENT_CHECKPOINT_AUTOSUBMIT === "true",
    bundlerConfigured: config.AGENT_BUNDLER_PROVIDER !== "disabled" && Boolean(config.AGENT_BUNDLER_RPC_URL),
    scope: "executeCheckpointUserOp-only",
  };
}

export async function submitCheckpointUserOperation(input: {
  tokenId: bigint;
  walletAddress: string;
  auth: ActionAuth;
  sessionKey: Address;
  categoryName: CheckpointCategoryName;
  payloadHash: Hex;
  waitForReceipt?: boolean;
}) {
  if (!config.AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY) {
    throw new ApiError(409, "CHECKPOINT_SIGNER_NOT_CONFIGURED", "Configure AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY with the granted session key before submitting checkpoint UserOperations.");
  }
  if (config.AGENT_BUNDLER_PROVIDER === "disabled" || !config.AGENT_BUNDLER_RPC_URL) {
    throw new ApiError(409, "BUNDLER_NOT_CONFIGURED", "Configure AGENT_BUNDLER_PROVIDER and AGENT_BUNDLER_RPC_URL before submitting checkpoint UserOperations.");
  }

  const signer = privateKeyToAccount(config.AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY as Hex);
  if (signer.address.toLowerCase() !== input.sessionKey.toLowerCase()) {
    throw new ApiError(409, "CHECKPOINT_SIGNER_MISMATCH", "The configured checkpoint signer does not match the requested session key.");
  }

  const preflight = await preflightCheckpointSponsorship(input);
  const { maxFeePerGas, maxPriorityFeePerGas } = await selectedGasFees();
  const unsignedUserOp = {
    sender: preflight.account,
    nonce: BigInt(preflight.nonce),
    initCode: "0x" as Hex,
    callData: preflight.callData as Hex,
    accountGasLimits: pack128(verificationGasLimit, callGasLimit),
    preVerificationGas,
    gasFees: pack128(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData: "0x" as Hex,
    signature: "0x" as Hex,
  };
  const localUserOperationHash = await arcClient.readContract({ address: erc4337EntryPoint as Address, abi: entryPointAbi, functionName: "getUserOpHash", args: [unsignedUserOp] });
  const signature = await signer.signMessage({ message: { raw: toBytes(localUserOperationHash) } });
  const rpcUserOperation: UserOperationRpc = {
    sender: unsignedUserOp.sender,
    nonce: toHex(unsignedUserOp.nonce),
    callData: unsignedUserOp.callData,
    callGasLimit: toHex(callGasLimit),
    verificationGasLimit: toHex(verificationGasLimit),
    preVerificationGas: toHex(unsignedUserOp.preVerificationGas),
    maxFeePerGas: toHex(maxFeePerGas),
    maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
    signature,
  };
  const userOperationHash = await sendUserOperation(rpcUserOperation);
  const receipt = input.waitForReceipt ? await waitForUserOpReceipt(userOperationHash) : null;
  return {
    ...preflight,
    submitted: true,
    userOperationHash,
    localUserOperationHash,
    receipt,
    gas: {
      callGasLimit: callGasLimit.toString(),
      verificationGasLimit: verificationGasLimit.toString(),
      preVerificationGas: preVerificationGas.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    },
  };
}