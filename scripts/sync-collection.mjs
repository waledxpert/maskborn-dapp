import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arcRoot = path.resolve(process.env.ARCONE_PATH ?? path.join(root, "..", "arcOne"));
const manifestPath = path.join(arcRoot, "contracts", "data", "manifest.json");
const collectionPath = path.join(root, "frontend", "src", "generated", "collection.json");
const backendCollectionPath = path.join(root, "backend", "src", "generated", "collection.json");
const rendererPath = path.join(root, "frontend", "src", "generated", "renderer.json");
const publicRoot = path.join(root, "frontend", "public");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const manifest = await readJson(manifestPath);
const collection = await readJson(collectionPath);
const renderer = await readJson(rendererPath);

const expectedCounts = Object.fromEntries(
  collection.layerOrder.map((layer) => [
    layer,
    layer === "Fur" ? manifest.coats.length : manifest.layers[layer],
  ]),
);

for (const category of collection.categories) {
  const expected = expectedCounts[category.name];
  if (category.count !== expected || category.traits.length !== expected) {
    throw new Error(`${category.name}: snapshot=${category.traits.length}, generator manifest=${expected}`);
  }
  for (const trait of category.traits) {
    await access(path.join(publicRoot, trait.preview.replace(/^\//, "")));
  }
}

if (collection.legends.length !== manifest.legendary) {
  throw new Error(`Legend count: snapshot=${collection.legends.length}, generator manifest=${manifest.legendary}`);
}
if (renderer.canvas.width !== 32 || renderer.canvas.height !== 32) {
  throw new Error("Renderer snapshot must remain 32×32.");
}

collection.status = "PRELAUNCH";
delete collection.arcTestnet;
await writeFile(collectionPath, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
await writeFile(backendCollectionPath, `${JSON.stringify(collection, null, 2)}\n`, "utf8");

console.log(
  `Verified JS snapshot: ${collection.categories.reduce((sum, category) => sum + category.count, 0)} traits, `
  + `${collection.legends.length} 1/1 references, ${collection.fixtures.length} generated previews.`,
);
