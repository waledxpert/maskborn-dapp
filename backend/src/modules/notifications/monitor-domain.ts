export type PaymentDirection = "INCOMING" | "OUTGOING";
export type MonitorCadenceValue = "CONTINUOUS" | "DAILY" | "WEEKLY";

export function directionFor(watchedAddress: string, fromAddress: string, toAddress: string): PaymentDirection | null {
  const watched = watchedAddress.toLowerCase();
  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  if (to === watched && from !== watched) return "INCOMING";
  if (from === watched && to !== watched) return "OUTGOING";
  return null;
}

export function acceptsPayment(input: {
  configuredDirection: "INCOMING" | "OUTGOING" | "BOTH";
  actualDirection: PaymentDirection;
  counterparty?: string | null;
  fromAddress: string;
  toAddress: string;
  amount: bigint;
  minimumAmount: bigint;
}) {
  if (input.configuredDirection !== "BOTH" && input.configuredDirection !== input.actualDirection) return false;
  if (input.amount < input.minimumAmount) return false;
  if (!input.counterparty) return true;
  const counterparty = input.counterparty.toLowerCase();
  return input.actualDirection === "INCOMING"
    ? input.fromAddress.toLowerCase() === counterparty
    : input.toAddress.toLowerCase() === counterparty;
}

export function nextOccurrence(date: Date, cadence: MonitorCadenceValue) {
  const next = new Date(date);
  if (cadence === "DAILY") next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export function previousOccurrence(date: Date, cadence: MonitorCadenceValue) {
  const previous = new Date(date);
  if (cadence === "DAILY") previous.setUTCDate(previous.getUTCDate() - 1);
  if (cadence === "WEEKLY") previous.setUTCDate(previous.getUTCDate() - 7);
  return previous;
}
