import { getAddress } from "viem";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { arcClient, maskBornAddress, transferEvent } from "./client.js";
import { ownershipTransition } from "./ownership-domain.js";

const STREAM = "erc721-transfers-v1";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRpcError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("rate limit")
    || message.includes("limit exceeded")
    || message.includes("request exceeds defined limit")
    || message.includes("fetch failed")
    || message.includes("http request failed")
    || message.includes("socket")
    || message.includes("timeout");
}

async function withRpcBackoff<T>(run: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || attempt === attempts - 1) throw error;
      await sleep(1_500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function resolveDeploymentBlock(latestBlock: bigint) {
  if (!maskBornAddress) throw new Error("Mask Born collection is not configured.");
  const collection = maskBornAddress;
  if (config.ARC_DEPLOYMENT_BLOCK > 0) return BigInt(config.ARC_DEPLOYMENT_BLOCK);

  const latestCode = await withRpcBackoff(() => arcClient.getBytecode({ address: collection, blockNumber: latestBlock }));
  if (!latestCode || latestCode === "0x") throw new Error("Configured Mask Born address has no code at the latest block.");

  let low = 0n;
  let high = latestBlock;
  while (low < high) {
    const middle = (low + high) / 2n;
    const code = await withRpcBackoff(() => arcClient.getBytecode({ address: collection, blockNumber: middle }));
    if (code && code !== "0x") high = middle;
    else low = middle + 1n;
  }
  return low;
}

async function applyTransfer(log: {
  args: { from: `0x${string}`; to: `0x${string}`; value: bigint };
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
}, blockTime: Date) {
  const collectionAddress = maskBornAddress!.toLowerCase();
  const txHash = log.transactionHash.toLowerCase();
  const fromAddress = getAddress(log.args.from).toLowerCase();
  const toAddress = getAddress(log.args.to).toLowerCase();
  const tokenId = log.args.value.toString();

  await db.$transaction(async (transaction) => {
    const existing = await transaction.chainEvent.findUnique({
      where: { chainId_txHash_logIndex: { chainId: config.ARC_CHAIN_ID, txHash, logIndex: log.logIndex } },
      select: { id: true },
    });
    if (existing) return;

    const current = await transaction.ownershipPeriod.findFirst({
      where: { chainId: config.ARC_CHAIN_ID, collectionAddress, tokenId, endedBlock: null },
      orderBy: { sequence: "desc" },
    });
    const transition = ownershipTransition(current && { sequence: current.sequence, ownerAddress: current.ownerAddress }, fromAddress, toAddress);

    if (transition.closeCurrent && current) {
      await transaction.ownershipPeriod.update({
        where: { id: current.id },
        data: { endedBlock: log.blockNumber, endedTxHash: txHash, endedLogIndex: log.logIndex, endedAt: blockTime },
      });
    }
    if (transition.open) {
      const wallet = await transaction.wallet.findFirst({
        where: { chain: "EVM", normalized: transition.open.ownerAddress.toLowerCase() },
        select: { id: true },
      });
      await transaction.ownershipPeriod.create({
        data: {
          chainId: config.ARC_CHAIN_ID,
          collectionAddress,
          tokenId,
          sequence: transition.open.sequence,
          ownerAddress: transition.open.ownerAddress.toLowerCase(),
          walletId: wallet?.id,
          startedBlock: log.blockNumber,
          startedTxHash: txHash,
          startedLogIndex: log.logIndex,
          startedAt: blockTime,
        },
      });
    }
    await transaction.chainEvent.create({
      data: {
        chainId: config.ARC_CHAIN_ID,
        collectionAddress,
        txHash,
        logIndex: log.logIndex,
        transactionIndex: log.transactionIndex,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash.toLowerCase(),
        eventName: "Transfer",
        tokenId,
        fromAddress,
        toAddress,
        blockTime,
      },
    });
  });
}

export async function syncCollectionTransfers(maxBatches = 25) {
  if (!maskBornAddress) return { configured: false as const };
  const collection = maskBornAddress;
  const latestBlock = await withRpcBackoff(() => arcClient.getBlockNumber());
  const collectionAddress = collection.toLowerCase();
  const deploymentBlock = await resolveDeploymentBlock(latestBlock);
  const cursor = await db.chainCursor.upsert({
    where: { chainId_collectionAddress_stream: { chainId: config.ARC_CHAIN_ID, collectionAddress, stream: STREAM } },
    create: { chainId: config.ARC_CHAIN_ID, collectionAddress, stream: STREAM, nextBlock: deploymentBlock },
    update: {},
  });

  let nextBlock = cursor.nextBlock;
  let batches = 0;
  let events = 0;
  try {
    while (nextBlock <= latestBlock && batches < maxBatches) {
      const lastCandidate = nextBlock + BigInt(config.ARC_INDEX_BATCH_SIZE) - 1n;
      const toBlock = lastCandidate > latestBlock ? latestBlock : lastCandidate;
      const logs = await withRpcBackoff(() => arcClient.getLogs({
        address: collection,
        event: transferEvent,
        fromBlock: nextBlock,
        toBlock,
        strict: true,
      }));
      const blockTimes = new Map<bigint, Date>();
      for (const log of logs) {
        let blockTime = blockTimes.get(log.blockNumber);
        if (!blockTime) {
          const block = await withRpcBackoff(() => arcClient.getBlock({ blockNumber: log.blockNumber }));
          blockTime = new Date(Number(block.timestamp) * 1_000);
          blockTimes.set(log.blockNumber, blockTime);
        }
        await applyTransfer(log, blockTime);
        events += 1;
      }
      const checkpoint = await withRpcBackoff(() => arcClient.getBlock({ blockNumber: toBlock }));
      nextBlock = toBlock + 1n;
      await db.chainCursor.updateMany({
        where: { id: cursor.id, nextBlock: { lte: toBlock } },
        data: { nextBlock, lastBlockHash: checkpoint.hash, lastError: null, lastErrorAt: null },
      });
      batches += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "Unknown collection indexer error";
    await db.chainCursor.update({ where: { id: cursor.id }, data: { lastError: message, lastErrorAt: new Date() } });
    throw error;
  }

  return { configured: true as const, deploymentBlock, nextBlock, latestBlock, caughtUp: nextBlock > latestBlock, batches, events };
}

export async function collectionIndexStatus() {
  if (!maskBornAddress) return { configured: false as const };
  const collectionAddress = maskBornAddress.toLowerCase();
  const [latestBlock, cursor] = await Promise.all([
    withRpcBackoff(() => arcClient.getBlockNumber()),
    db.chainCursor.findUnique({ where: { chainId_collectionAddress_stream: { chainId: config.ARC_CHAIN_ID, collectionAddress, stream: STREAM } } }),
  ]);
  return {
    configured: true as const,
    latestBlock,
    nextBlock: cursor?.nextBlock ?? null,
    indexedThrough: cursor ? cursor.nextBlock - 1n : null,
    caughtUp: Boolean(cursor && cursor.nextBlock > latestBlock),
    lastError: cursor?.lastError ?? null,
    updatedAt: cursor?.updatedAt ?? null,
  };
}




