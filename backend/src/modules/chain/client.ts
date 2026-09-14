import { createPublicClient, defineChain, getAddress, http, parseAbiItem, type Address, type Hex } from "viem";
import { config } from "../../config.js";
import { maskBornAccountV1Abi, maskBornAccountV2Abi, maskBornAgentRegistryAbi } from "../../generated/agent-contracts.js";

export { maskBornAccountV1Abi, maskBornAccountV2Abi, maskBornAgentRegistryAbi };

export const arcChain = defineChain({
  id: config.ARC_CHAIN_ID,
  name: config.ARC_CHAIN_ID === 5042002 ? "Arc Testnet" : "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
});

export const arcClient = createPublicClient({ chain: arcChain, transport: http(config.ARC_RPC_URL) });
export const maskBornAddress = config.MASKBORN_CONTRACT_ADDRESS
  ? getAddress(config.MASKBORN_CONTRACT_ADDRESS)
  : null;
export const maskBornAgentRegistryAddress = config.MASKBORN_AGENT_REGISTRY_ADDRESS
  ? getAddress(config.MASKBORN_AGENT_REGISTRY_ADDRESS)
  : null;
export const arcUsdcAddress = getAddress("0x3600000000000000000000000000000000000000");
export const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const maskBornAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "traitsOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "uint16[8]" }] },
  { type: "function", name: "isRevealed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tokensOfOwner", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] },
] as const;

export async function readAgentBinding(tokenId: bigint) {
  if (!maskBornAgentRegistryAddress) return { configured: false as const };
  const blockNumber = await arcClient.getBlockNumber();
  const [binding, identityRegistry, account] = await Promise.all([
    arcClient.readContract({
      address: maskBornAgentRegistryAddress,
      abi: maskBornAgentRegistryAbi,
      functionName: "bindingOf",
      args: [tokenId],
      blockNumber,
    }),
    arcClient.readContract({
      address: maskBornAgentRegistryAddress,
      abi: maskBornAgentRegistryAbi,
      functionName: "identityRegistry",
      blockNumber,
    }),
    arcClient.readContract({
      address: maskBornAgentRegistryAddress,
      abi: maskBornAgentRegistryAbi,
      functionName: "accountOf",
      args: [tokenId],
      blockNumber,
    }),
  ]);
  const { account: boundAccount, agentId, constitutionHash, agentURIHash, awakenedAtBlock } = binding;
  return {
    configured: true as const,
    awakened: boundAccount !== "0x0000000000000000000000000000000000000000",
    account: getAddress(boundAccount === "0x0000000000000000000000000000000000000000" ? account : boundAccount),
    agentId,
    constitutionHash: constitutionHash as Hex,
    agentURIHash: agentURIHash as Hex,
    awakenedAtBlock,
    identityRegistry: getAddress(identityRegistry),
    blockNumber,
  };
}

export async function readOwnedTokenIds(owner: Address) {
  if (!maskBornAddress) return { configured: false as const };
  const blockNumber = await arcClient.getBlockNumber();
  const tokenIds = await arcClient.readContract({
    address: maskBornAddress,
    abi: maskBornAbi,
    functionName: "tokensOfOwner",
    args: [owner],
    blockNumber,
  });
  return { configured: true as const, tokenIds, blockNumber };
}

export async function readToken(tokenId: bigint) {
  if (!maskBornAddress) return { configured: false as const };
  const blockNumber = await arcClient.getBlockNumber();
  const owner = await arcClient.readContract({ address: maskBornAddress, abi: maskBornAbi, functionName: "ownerOf", args: [tokenId], blockNumber });
  const revealed = await arcClient.readContract({ address: maskBornAddress, abi: maskBornAbi, functionName: "isRevealed", blockNumber }).catch(() => false);
  const traits = revealed
    ? await arcClient.readContract({ address: maskBornAddress, abi: maskBornAbi, functionName: "traitsOf", args: [tokenId], blockNumber })
    : null;
  return { configured: true as const, owner: getAddress(owner), revealed, traits, blockNumber };
}

export async function readTokenURI(tokenId: bigint, blockNumber?: bigint) {
  if (!maskBornAddress) return { configured: false as const };
  const sourceBlock = blockNumber ?? await arcClient.getBlockNumber();
  const tokenURI = await arcClient.readContract({
    address: maskBornAddress,
    abi: maskBornAbi,
    functionName: "tokenURI",
    args: [tokenId],
    blockNumber: sourceBlock,
  });
  return { configured: true as const, tokenURI, blockNumber: sourceBlock };
}

export async function readNativeUsdc(address: Address) {
  const blockNumber = await arcClient.getBlockNumber();
  const balance = await arcClient.getBalance({ address, blockNumber });
  return { balance, blockNumber };
}

export async function readAgentAccount(account: Address) {
  const blockNumber = await arcClient.getBlockNumber();
  const [balance, paused, state, agentId, agentURIHash, maxSessionDuration, maxSessionCalls] = await Promise.all([
    arcClient.getBalance({ address: account, blockNumber }),
    arcClient.readContract({ address: account, abi: maskBornAccountV1Abi, functionName: "executionPaused", blockNumber }),
    arcClient.readContract({ address: account, abi: maskBornAccountV1Abi, functionName: "state", blockNumber }),
    arcClient.readContract({ address: account, abi: maskBornAccountV1Abi, functionName: "agentId", blockNumber }),
    arcClient.readContract({ address: account, abi: maskBornAccountV1Abi, functionName: "agentURIHash", blockNumber }),
    arcClient.readContract({ address: account, abi: maskBornAccountV2Abi, functionName: "MAX_SESSION_DURATION", blockNumber }).catch(() => null),
    arcClient.readContract({ address: account, abi: maskBornAccountV2Abi, functionName: "MAX_SESSION_CALLS", blockNumber }).catch(() => null),
  ]);
  return {
    balance, paused, state, agentId, agentURIHash, blockNumber,
    checkpointSessions: maxSessionDuration !== null && maxSessionCalls !== null
      ? { maxDurationSeconds: maxSessionDuration, maxCalls: maxSessionCalls }
      : null,
  };
}

export async function readCheckpointSession(account: Address, sessionKey: Address) {
  const blockNumber = await arcClient.getBlockNumber();
  const [permission, block] = await Promise.all([
    arcClient.readContract({
      address: account,
      abi: maskBornAccountV2Abi,
      functionName: "checkpointSessions",
      args: [sessionKey],
      blockNumber,
    }),
    arcClient.getBlock({ blockNumber }),
  ]);
  const [authorizedOwner, validAfter, validUntil, maxCalls, calls, revoked] = permission;
  return { authorizedOwner: getAddress(authorizedOwner), validAfter, validUntil, maxCalls, calls, revoked, blockNumber, blockTimestamp: block.timestamp };
}
