import { describe, expect, it } from "vitest";
import { acceptsPayment, directionFor, nextOccurrence, previousOccurrence } from "./monitor-domain.js";

describe("payment monitor domain", () => {
  it("does not classify self transfers twice", () => {
    expect(directionFor("0xabc", "0xabc", "0xabc")).toBeNull();
  });

  it("applies direction, counterparty and integer amount limits", () => {
    expect(acceptsPayment({ configuredDirection: "INCOMING", actualDirection: "INCOMING", counterparty: "0xSender", fromAddress: "0xsender", toAddress: "0xowner", amount: 2_000_000n, minimumAmount: 1_000_000n })).toBe(true);
    expect(acceptsPayment({ configuredDirection: "OUTGOING", actualDirection: "INCOMING", counterparty: null, fromAddress: "0xsender", toAddress: "0xowner", amount: 2_000_000n, minimumAmount: 1_000_000n })).toBe(false);
  });

  it("advances UTC schedules deterministically", () => {
    const due = new Date("2026-09-13T12:00:00.000Z");
    expect(nextOccurrence(due, "DAILY").toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(previousOccurrence(due, "WEEKLY").toISOString()).toBe("2026-09-06T12:00:00.000Z");
  });
});
