import { createPublicClient, defineChain, getAddress, http, parseAbiItem, type Address } from "viem";
import { config } from "../../config.js";

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
export const arcUsdcAddress = getAddress("0x3600000000000000000000000000000000000000");
export const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const maskBornAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "traitsOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "uint16[8]" }] },
  { type: "function", name: "isRevealed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tokensOfOwner", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256[]" }] },
] as const;

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

export async function readNativeUsdc(address: Address) {
  const blockNumber = await arcClient.getBlockNumber();
  const balance = await arcClient.getBalance({ address, blockNumber });
  return { balance, blockNumber };
}
