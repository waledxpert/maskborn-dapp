import collection from "../../generated/collection.json" with { type: "json" };
import { keccak256, toBytes } from "viem";

type Trait = { name: string; tier: string };
type Category = { name: string; traits: Trait[] };

function traitAt(category: Category, index: number) {
  const trait = category.traits[index];
  return trait
    ? { category: category.name, index, name: trait.name, tier: trait.tier }
    : { category: category.name, index, name: `Trait ${index}`, tier: "Unknown" };
}

export function buildPersona(tokenId: bigint, traitIndexes: readonly number[]) {
  const traits = (collection.categories as Category[]).map((category, index) => traitAt(category, traitIndexes[index] ?? 0));
  const byCategory = Object.fromEntries(traits.map((trait) => [trait.category, trait]));
  const hat = byCategory.Hats?.name ?? "Uncovered";
  const eyes = byCategory.Eyes?.name ?? "Clear";
  const fur = byCategory.Fur?.name ?? "Natural";
  const ears = byCategory.Ears?.name ?? "Standard";
  const special = byCategory.Special?.name;
  const role = special && special !== "None" ? `${special.toLowerCase()} operator` : `${hat.toLowerCase()} analyst`;
  return {
    name: `Mask Born #${tokenId}`,
    role,
    summary: `A ${fur.toLowerCase()} Mask Born ${role} who studies with ${eyes.toLowerCase()} eyes and monitors through ${ears.toLowerCase()} ears.`,
    communicationStyle: `Direct, observant, and shaped by the ${hat} and ${eyes} traits.`,
    traits,
    constitutionVersion: 1,
  };
}

export function buildConstitution(tokenId: bigint, traitIndexes: readonly number[]) {
  const persona = buildPersona(tokenId, traitIndexes);
  const document = JSON.stringify({
    schema: "maskborn-constitution-v1",
    tokenId: tokenId.toString(),
    constitutionVersion: persona.constitutionVersion,
    role: persona.role,
    communicationStyle: persona.communicationStyle,
    traits: persona.traits.map(({ category, index, name, tier }) => ({ category, index, name, tier })),
  });
  return { document, hash: keccak256(toBytes(document)) };
}
