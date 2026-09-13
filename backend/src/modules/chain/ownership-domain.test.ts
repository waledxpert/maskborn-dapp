import { describe, expect, it } from "vitest";
import { ownershipTransition, ZERO_ADDRESS } from "./ownership-domain.js";

describe("ownership transitions", () => {
  it("opens the first period on mint", () => {
    expect(ownershipTransition(null, ZERO_ADDRESS, "0xA")).toEqual({ closeCurrent: false, open: { sequence: 1, ownerAddress: "0xA" } });
  });

  it("closes and reopens on self-transfer", () => {
    expect(ownershipTransition({ sequence: 4, ownerAddress: "0xA" }, "0xa", "0xA")).toEqual({ closeCurrent: true, open: { sequence: 5, ownerAddress: "0xA" } });
  });

  it("creates a fresh period when ownership returns A to B to A", () => {
    const toB = ownershipTransition({ sequence: 1, ownerAddress: "0xA" }, "0xA", "0xB");
    const toA = ownershipTransition(toB.open, "0xB", "0xA");
    expect(toA.open).toEqual({ sequence: 3, ownerAddress: "0xA" });
  });

  it("fails closed when history is inconsistent", () => {
    expect(() => ownershipTransition({ sequence: 1, ownerAddress: "0xA" }, "0xB", "0xC")).toThrow(/indexed owner/);
  });
});
