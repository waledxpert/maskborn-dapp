export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type CurrentOwnership = { sequence: number; ownerAddress: string } | null;

export type OwnershipTransition = {
  closeCurrent: boolean;
  open: { sequence: number; ownerAddress: string } | null;
};

export function ownershipTransition(
  current: CurrentOwnership,
  fromAddress: string,
  toAddress: string,
): OwnershipTransition {
  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  const zero = ZERO_ADDRESS.toLowerCase();

  if (!current && from !== zero) throw new Error("Ownership history does not begin with a mint.");
  if (current && current.ownerAddress.toLowerCase() !== from) throw new Error("Transfer sender does not match the indexed owner.");

  return {
    closeCurrent: Boolean(current),
    open: to === zero ? null : { sequence: (current?.sequence ?? 0) + 1, ownerAddress: toAddress },
  };
}
