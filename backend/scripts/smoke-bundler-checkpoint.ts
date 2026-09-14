import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toBytes,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcChain, arcClient, maskBornAccountV2Abi } from "../src/modules/chain/client.js";
import { bundlerRequest, erc4337EntryPoint, getUserOperationReceipt, sendUserOperation, type UserOperationRpc } from "../src/modules/chain/bundler.js";
import { config } from "../src/config.js";

const entryPointAbi = parseAbi([
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function balanceOf(address account) view returns (uint256)",
  "function withdrawTo(address payable withdrawAddress,uint256 withdrawAmount)",
]);
const registryAbi = parseAbi(["function bindingOf(uint256 tokenId) view returns ((address account,uint256 agentId,bytes32 constitutionHash,bytes32 agentURIHash,uint256 awakenedAtBlock))"]);

const accountFunding = parseEther("0.3");
const verificationGasLimit = 500_000n;
const callGasLimit = 250_000n;
const preVerificationGas = 100_000n;
const ownerTxFees = { maxFeePerGas: 300_000_000_000n, maxPriorityFeePerGas: 5_000_000_000n };
const zeroAddress = "0x0000000000000000000000000000000000000000";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function pack128(high: bigint, low: bigint) {
  return toHex((high << 128n) | low, { size: 32 });
}

async function waitForUserOpReceipt(userOpHash: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const receipt = await getUserOperationReceipt(userOpHash);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${userOpHash}`);
}

const holder = privateKeyToAccount(requiredEnv("PRIVATE_KEY") as Hex);
const session = privateKeyToAccount(requiredEnv("SESSION_PRIVATE_KEY") as Hex);
const tokenId = BigInt(process.env.TOKEN_ID ?? "1");
const registry = getAddress(requiredEnv("MASKBORN_AGENT_REGISTRY_ADDRESS"));
const publicClient = createPublicClient({ chain: arcChain, transport: http(config.ARC_RPC_URL) });
const walletClient = createWalletClient({ account: holder, chain: arcChain, transport: http(config.ARC_RPC_URL) });

if (config.AGENT_BUNDLER_PROVIDER === "disabled") throw new Error("AGENT_BUNDLER_PROVIDER is disabled");
if (config.AGENT_PAYMASTER_PROVIDER !== "disabled") throw new Error("This smoke expects sponsorship/paymaster disabled");
if (holder.address.toLowerCase() === session.address.toLowerCase()) throw new Error("Use a separate session key");

const binding = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "bindingOf", args: [tokenId] });
const accountAddress = getAddress(binding.account);
if (accountAddress === zeroAddress) throw new Error(`Token ${tokenId} is not awakened`);

const latestBlock = await publicClient.getBlock();
const validAfter = latestBlock.timestamp;
const validUntil = validAfter + 3600n;
const grantHash = await walletClient.writeContract({
  address: accountAddress,
  abi: maskBornAccountV2Abi,
  functionName: "grantCheckpointSession",
  args: [session.address, validAfter, validUntil, 1],
  ...ownerTxFees,
});
await publicClient.waitForTransactionReceipt({ hash: grantHash });

const balance = await publicClient.getBalance({ address: accountAddress });
if (balance < accountFunding) {
  const fundHash = await walletClient.sendTransaction({ to: accountAddress, value: accountFunding - balance, ...ownerTxFees });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
}

const nonce = await publicClient.readContract({ address: accountAddress, abi: maskBornAccountV2Abi, functionName: "getUserOpNonce" });
const gasPrice = await bundlerRequest<{ fast?: { maxFeePerGas: string; maxPriorityFeePerGas: string }; standard?: { maxFeePerGas: string; maxPriorityFeePerGas: string } }>("pimlico_getUserOperationGasPrice", []).catch(() => null);
const selectedGasPrice = gasPrice?.fast ?? gasPrice?.standard;
const maxFeePerGas = selectedGasPrice ? BigInt(selectedGasPrice.maxFeePerGas) : 60_000_000_000n;
const maxPriorityFeePerGas = selectedGasPrice ? BigInt(selectedGasPrice.maxPriorityFeePerGas) : 2_000_000_000n;
const category = await publicClient.readContract({ address: accountAddress, abi: maskBornAccountV2Abi, functionName: "LIVENESS_CHECKPOINT" });
const payloadHash = keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "uint256" }], ["MASKBORN_PIMLICO_SMOKE_V1", tokenId, latestBlock.number]));
const callData = encodeFunctionData({
  abi: maskBornAccountV2Abi,
  functionName: "executeCheckpointUserOp",
  args: [session.address, category, payloadHash],
});

const unsignedUserOp = {
  sender: accountAddress,
  nonce,
  initCode: "0x" as Hex,
  callData,
  accountGasLimits: pack128(verificationGasLimit, callGasLimit),
  preVerificationGas,
  gasFees: pack128(maxPriorityFeePerGas, maxFeePerGas),
  paymasterAndData: "0x" as Hex,
  signature: "0x" as Hex,
};
const userOpHash = await publicClient.readContract({ address: erc4337EntryPoint, abi: entryPointAbi, functionName: "getUserOpHash", args: [unsignedUserOp] });
const signature = await session.signMessage({ message: { raw: toBytes(userOpHash) } });
const userOperation = { ...unsignedUserOp, signature };
const rpcUserOperation: UserOperationRpc = {
  sender: userOperation.sender,
  nonce: toHex(userOperation.nonce),
  callData: userOperation.callData,
  callGasLimit: toHex(callGasLimit),
  verificationGasLimit: toHex(verificationGasLimit),
  preVerificationGas: toHex(userOperation.preVerificationGas),
  maxFeePerGas: toHex(maxFeePerGas),
  maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
  signature: userOperation.signature,
};

const submittedHash = await sendUserOperation(rpcUserOperation);
const userOpReceipt = await waitForUserOpReceipt(submittedHash);

const revokeHash = await walletClient.writeContract({ address: accountAddress, abi: maskBornAccountV2Abi, functionName: "revokeCheckpointSession", args: [session.address], ...ownerTxFees });
await publicClient.waitForTransactionReceipt({ hash: revokeHash });

const deposit = await publicClient.readContract({ address: erc4337EntryPoint, abi: entryPointAbi, functionName: "balanceOf", args: [accountAddress] });
if (deposit > 0n) {
  const withdrawData = encodeFunctionData({ abi: entryPointAbi, functionName: "withdrawTo", args: [holder.address, deposit] });
  const withdrawHash = await walletClient.writeContract({ address: accountAddress, abi: maskBornAccountV2Abi, functionName: "execute", args: [erc4337EntryPoint, 0n, withdrawData, 0], ...ownerTxFees });
  await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
}
const remainder = await publicClient.getBalance({ address: accountAddress });
if (remainder > 0n) {
  const sweepHash = await walletClient.writeContract({ address: accountAddress, abi: maskBornAccountV2Abi, functionName: "execute", args: [holder.address, remainder, "0x", 0], ...ownerTxFees });
  await publicClient.waitForTransactionReceipt({ hash: sweepHash });
}

console.log(JSON.stringify({
  provider: config.AGENT_BUNDLER_PROVIDER,
  tokenId: tokenId.toString(),
  account: accountAddress,
  sessionSigner: session.address,
  userOpHash: submittedHash,
  localUserOpHash: userOpHash,
  receipt: userOpReceipt,
  grantTx: grantHash,
  revokeTx: revokeHash,
}, null, 2));
