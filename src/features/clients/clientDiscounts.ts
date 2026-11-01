/**
 * Client discounts (`client_discounts`, crm_ro_v1): one row per (client, target).
 * `fixed` mode stores a percent; `price_type` mode points at a price list (shown, not editable here).
 */
import { computeOrderMoney, lineDiscountAmount, roundMoney } from "../orders/orderTotals";

export const CLIENT_DISCOUNT_TARGETS = ["service_order", "service_sale", "product_order", "product_sale"] as const;
export type ClientDiscountTarget = (typeof CLIENT_DISCOUNT_TARGETS)[number];
export type ClientDiscountMode = "fixed" | "price_type";

export type ClientDiscount = {
  id: string;
  clientId: string;
  target: ClientDiscountTarget;
  mode: ClientDiscountMode;
  /** Percent 0–100 for `fixed` mode; null for `price_type`. */
  percent: number | null;
  priceTypeId: string | null;
  updatedAt: string;
};

export function isClientDiscountTarget(value: unknown): value is ClientDiscountTarget {
  return typeof value === "string" && (CLIENT_DISCOUNT_TARGETS as readonly string[]).includes(value);
}

/**
 * Parses a percent typed by a user ("10", "7,5"). Returns null for blank (= no discount),
 * NaN for invalid input and values outside 0–100. Result is rounded to 3 decimals (column is numeric(7,3)).
 */
export function parseDiscountPercent(input: string): number | null {
  const trimmed = input.trim().replace(",", ".");
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return Number.NaN;
  const value = Math.round(Number(trimmed) * 1000) / 1000;
  return value > 100 ? Number.NaN : value;
}

/** The percent that actually reduces prices: fixed mode with a positive percent. */
export function effectiveDiscountPercent(discount: Pick<ClientDiscount, "mode" | "percent"> | null | undefined): number {
  if (!discount || discount.mode !== "fixed") return 0;
  const percent = Number(discount.percent ?? 0);
  return Number.isFinite(percent) && percent > 0 ? Math.min(percent, 100) : 0;
}

export function findClientDiscount(discounts: readonly ClientDiscount[], target: ClientDiscountTarget) {
  return discounts.find((discount) => discount.target === target) ?? null;
}

/** `amount` reduced by `percent`, rounded to cents. Never negative. Same math as `orderTotals`. */
export function applyDiscountPercent(amount: number, percent: number) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  if (!(percent > 0)) return roundMoney(safeAmount);
  return roundMoney(safeAmount - lineDiscountAmount(roundMoney(safeAmount), "percent", percent));
}

/**
 * Totals for a set of lines with the client's `service_order` / `product_order` percents. Uses the exact math
 * that is persisted into `orders.total_price` / `orders.discount_total` (`orderTotals.ts`), so what the form
 * shows is what gets saved. Prefer `computeOrderMoney` + `stampClientDiscountsOnLines` when line data exists.
 */
export function estimateDiscountedTotal(
  input: { servicesTotal: number; materialsTotal: number },
  discounts: readonly ClientDiscount[],
) {
  const servicePercent = effectiveDiscountPercent(findClientDiscount(discounts, "service_order"));
  const productPercent = effectiveDiscountPercent(findClientDiscount(discounts, "product_order"));
  const money = computeOrderMoney({
    services: [{ price: input.servicesTotal, qty: 1, discountType: servicePercent > 0 ? "percent" : null, discountValue: servicePercent }],
    materials: [{ price: input.materialsTotal, qty: 1, discountType: productPercent > 0 ? "percent" : null, discountValue: productPercent }],
  });
  return {
    servicePercent,
    productPercent,
    hasDiscount: servicePercent > 0 || productPercent > 0,
    subtotal: money.subtotal,
    discountTotal: money.discountTotal,
    total: money.total,
  };
}
