import { describe, expect, it } from "vitest";
import { buildPersona } from "../src/modules/agents/persona.js";

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
});
