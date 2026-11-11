import type { OrderMaterial } from "../../lib/types";
import { materialIssued, materialReturned } from "../inventory/warehouseMaterialStatus";

export type MaterialQuantityStockDelta =
  | { kind: "none" }
  | { kind: "issue"; quantity: number }
  | { kind: "return"; quantity: number }
  | { kind: "blocked"; reason: "below_outstanding" };

function roundQty(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Decide warehouse movement for a catalog material quantity change.
 *
 * - Increase: write off (issue) the quantity difference.
 * - Decrease when outstanding (issued − returned) still fits under the new qty: no movement
 *   (only reduces "to issue").
 * - Decrease when outstanding would exceed the new qty: return the excess so counters stay
 *   consistent; the companion RPC also collapses issued/returned so a fully-issued line stays
 *   fully issued after a shrink.
 */
export function materialQuantityStockDelta(
  line: Pick<OrderMaterial, "quantity" | "quantityIssued" | "quantityReturned">,
  nextQuantity: number,
): MaterialQuantityStockDelta {
  const oldQty = roundQty(Number(line.quantity) || 0);
  const next = roundQty(nextQuantity);
  if (!(next > 0) || !Number.isFinite(next)) {
    return { kind: "blocked", reason: "below_outstanding" };
  }
  if (next === oldQty) return { kind: "none" };

  const issued = materialIssued(line);
  const returned = materialReturned(line);
  const outstanding = roundQty(Math.max(0, issued - returned));

  if (next > oldQty) {
    return { kind: "issue", quantity: roundQty(next - oldQty) };
  }

  // Shrinking past net-outside requires a return (+ counter collapse in the RPC).
  if (next < outstanding) {
    return { kind: "return", quantity: roundQty(outstanding - next) };
  }

  return { kind: "none" };
}

/** True when the typed unit price is below a known purchase price (warning only; never blocks). */
export function isMaterialPriceBelowPurchase(unitPrice: number, purchasePrice: number | null | undefined) {
  if (purchasePrice == null || !(purchasePrice > 0)) return false;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return false;
  return unitPrice < purchasePrice;
}
