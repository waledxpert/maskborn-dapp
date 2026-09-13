import { describe, expect, it } from "vitest";
import type { AgentAction } from "../src/generated/prisma/client.js";
import { transactionMatches } from "../src/modules/agents/actions.js";

const sender = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const callData = "0x1234";

function stored(overrides: Partial<AgentAction> = {}) {
  return {
    senderAddress: sender,
    targetAddress: target,
    callData,
    transactionValueBaseUnits: { toString: () => "0" },
    ...overrides,
  } as unknown as AgentAction;
}

describe("agent action transaction matching", () => {
  it("accepts only the exact reviewed transaction", () => {
    expect(transactionMatches(stored(), { from: sender, to: target, input: callData, value: 0n })).toBe(true);
  });

  it.each([
    { from: "0x3333333333333333333333333333333333333333", to: target, input: callData, value: 0n },
    { from: sender, to: "0x3333333333333333333333333333333333333333", input: callData, value: 0n },
    { from: sender, to: target, input: "0xabcd", value: 0n },
    { from: sender, to: target, input: callData, value: 1n },
    { from: sender, to: null, input: callData, value: 0n },
  ])("rejects a changed sender, target, calldata, or value", (transaction) => {
    expect(transactionMatches(stored(), transaction)).toBe(false);
  });
});
