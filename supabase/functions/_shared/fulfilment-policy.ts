/**
 * Canonical postage deduction function — Deno-compatible shared module.
 * This MUST stay byte-identical in logic to src/utils/fulfilment-settings.ts
 * getPostageDeductionForOrder(). Any change here must be mirrored there.
 */

export function getPostageDeductionForOrder(
  fulfilmentMethod: string | null | undefined,
  lineChannel: string | null | undefined,
  postageCostPerOrder: number,
  orderCount: number = 1,
): number {
  if (!postageCostPerOrder || postageCostPerOrder <= 0) return 0;

  const ch = (lineChannel || "").toUpperCase().trim();

  if (fulfilmentMethod === "mixed_fba_fbm") {
    if (ch === "MFN") return postageCostPerOrder * orderCount;
    return 0;
  }

  if (ch === "AFN" || ch === "MCF") return 0;
  if (ch === "MFN") return postageCostPerOrder * orderCount;

  switch (fulfilmentMethod) {
    case "self_ship":
    case "third_party_logistics":
      return postageCostPerOrder * orderCount;
    default:
      return 0;
  }
}
