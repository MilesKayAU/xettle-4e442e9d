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
  // Zero-cost guard
  if (!postageCostPerOrder || postageCostPerOrder <= 0) return 0;

  const ch = (lineChannel || "").toUpperCase().trim();

  // Line-level channel takes priority when in mixed mode
  if (fulfilmentMethod === "mixed_fba_fbm") {
    // Only MFN (merchant-fulfilled) lines get postage deducted
    if (ch === "MFN") return postageCostPerOrder * orderCount;
    // AFN, MCF, or unknown/null → no deduction
    return 0;
  }

  // For explicit line channels regardless of marketplace setting
  if (ch === "AFN" || ch === "MCF") return 0;
  if (ch === "MFN") return postageCostPerOrder * orderCount;

  // Fall back to marketplace-level method
  switch (fulfilmentMethod) {
    case "self_ship":
    case "third_party_logistics":
      return postageCostPerOrder * orderCount;
    case "marketplace_fulfilled":
    case "not_sure":
    case null:
    case undefined:
    default:
      return 0;
  }
}
