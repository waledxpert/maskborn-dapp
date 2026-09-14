import "dotenv/config";
import { collectionIndexStatus, syncCollectionTransfers } from "../src/modules/chain/collection-indexer.js";

function serializeStatus(status: Awaited<ReturnType<typeof collectionIndexStatus>>) {
  return {
    configured: status.configured,
    latestBlock: status.latestBlock?.toString() ?? null,
    nextBlock: status.nextBlock?.toString() ?? null,
    indexedThrough: status.indexedThrough?.toString() ?? null,
    caughtUp: status.caughtUp,
    lastError: status.lastError,
    updatedAt: status.updatedAt,
  };
}

const maxBatches = Number.parseInt(process.argv[2] ?? "1000", 10);

const before = await collectionIndexStatus();
console.log(JSON.stringify({ before: serializeStatus(before) }, null, 2));

const result = await syncCollectionTransfers(maxBatches);
console.log(JSON.stringify({
  result: result.configured ? {
    configured: true,
    deploymentBlock: result.deploymentBlock.toString(),
    nextBlock: result.nextBlock.toString(),
    latestBlock: result.latestBlock.toString(),
    caughtUp: result.caughtUp,
    batches: result.batches,
    events: result.events,
  } : result,
}, null, 2));

const after = await collectionIndexStatus();
console.log(JSON.stringify({ after: serializeStatus(after) }, null, 2));
