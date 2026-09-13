import { describe, expect, it } from "vitest";
import { buildConstitution, buildPersona } from "../src/modules/agents/persona.js";

describe("Mask Born persona", () => {
  it("maps the eight canonical trait indexes into a stable public profile", () => {
    const persona = buildPersona(42n, [0, 0, 0, 0, 0, 0, 0, 0]);
    expect(persona.name).toBe("Mask Born #42");
    expect(persona.constitutionVersion).toBe(1);
    expect(persona.traits).toHaveLength(8);
    expect(persona.traits.map((trait) => trait.category)).toEqual([
      "Background", "Fur", "Eyes", "Ears", "Tails", "Masks", "Hats", "Special",
    ]);
    expect(persona.summary).toContain(persona.traits[1]!.name.toLowerCase());
  });

  it("keeps unknown indexes explicit instead of substituting a real trait", () => {
    const persona = buildPersona(1n, [999, 999, 999, 999, 999, 999, 999, 999]);
    expect(persona.traits.every((trait) => trait.tier === "Unknown")).toBe(true);
  });

  it("hashes the same canonical constitution deterministically", () => {
    const first = buildConstitution(42n, [0, 1, 2, 3, 4, 5, 6, 0]);
    const repeated = buildConstitution(42n, [0, 1, 2, 3, 4, 5, 6, 0]);
    const otherToken = buildConstitution(43n, [0, 1, 2, 3, 4, 5, 6, 0]);
    expect(first).toEqual(repeated);
    expect(first.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.hash).not.toBe(otherToken.hash);
    expect(JSON.parse(first.document)).toMatchObject({
      schema: "maskborn-constitution-v1",
      tokenId: "42",
      constitutionVersion: 1,
    });
  });
});
