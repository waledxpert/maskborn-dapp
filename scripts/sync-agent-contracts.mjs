import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const contractsOut = path.resolve(scriptsDir, "../../arcOne/contracts/out");
const output = path.resolve(scriptsDir, "../backend/src/generated/agent-contracts.ts");

const artifacts = [
  ["maskBornAgentRegistryAbi", "MaskBornAgentRegistry.sol/MaskBornAgentRegistry.json"],
  ["maskBornAccountV1Abi", "MaskBornAccountV1.sol/MaskBornAccountV1.json"],
  ["maskBornAccountV2Abi", "MaskBornAccountV2.sol/MaskBornAccountV2.json"],
];

const exports = [];
for (const [name, relativeArtifact] of artifacts) {
  const artifact = JSON.parse(await readFile(path.join(contractsOut, relativeArtifact), "utf8"));
  if (!Array.isArray(artifact.abi)) throw new Error(`Missing ABI in ${relativeArtifact}`);
  exports.push(`export const ${name} = ${JSON.stringify(artifact.abi, null, 2)} as const;`);
}

await writeFile(
  output,
  `// Generated from arcOne/contracts by npm run sync:agent-contracts. Do not hand-edit.\n\n${exports.join("\n\n")}\n`,
  "utf8",
);
console.log(`Synced ${artifacts.length} agent contract ABIs to ${output}`);
