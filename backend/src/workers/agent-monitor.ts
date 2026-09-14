import { config } from "../config.js";
import { db } from "../db.js";
import { syncActiveMonitors } from "../modules/notifications/monitor-service.js";
import { syncCollectionTransfers } from "../modules/chain/collection-indexer.js";
import { expireStaleSponsorshipReservations } from "../modules/agents/sponsorship.js";

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await syncCollectionTransfers();
    await expireStaleSponsorshipReservations();
    const results = await syncActiveMonitors();
    const failed = results.filter((result) => !result.ok);
    if (failed.length) console.error("Agent monitor failures", failed);
  } catch (error) {
    console.error("Agent monitor tick failed", error);
  } finally {
    running = false;
  }
}

console.log(`Mask Born agent monitor polling every ${config.AGENT_MONITOR_INTERVAL_MS}ms`);
void tick();
const timer = setInterval(() => void tick(), config.AGENT_MONITOR_INTERVAL_MS);

async function close(signal: string) {
  console.log(`${signal}: stopping agent monitor`);
  clearInterval(timer);
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void close("SIGINT"));
process.on("SIGTERM", () => void close("SIGTERM"));
