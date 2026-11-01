/**
 * Pure order money math. Single source of truth for what is persisted into
 * `orders.total_price` / `orders.discount_total` and what the order forms display.
 *
 * Line discounts mirror `order_services` / `order_materials` (`discount_type` 'percent' | 'amount',
 * `discount_value`). Everything is rounded to cents per line, then summed, so a displayed total always
 * equals the saved one.
 */
export type LineDiscountType = "percent" | "amount";

export type MoneyLine = {
  price: number;
  qty: number;
  discountType?: LineDiscountType | null;
  discountValue?: number | null;
};

export type OrderMoney = { subtotal: number; discountTotal: number; total: number };

/** Round to 2 decimals, half away from zero, without binary-float surprises (10.005 -> 10.01). */
export function roundMoney(n: number): number {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const shifted = Number(`${abs}e2`);
  const rounded = Number.isFinite(shifted) ? Math.round(shifted) : Math.round(abs * 100);
  const result = (sign * rounded) / 100;
  return result === 0 ? 0 : result;
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isLineDiscountType(value: unknown): value is LineDiscountType {
  return value === "percent" || value === "amount";
}

export function lineGross(price: number, qty: number): number {
  return roundMoney(safeNumber(price) * safeNumber(qty));
}

/** Percent of gross, or a fixed amount capped at gross. Never negative, never above gross. */
export function lineDiscountAmount(gross: number, discountType: LineDiscountType | null | undefined, discountValue: number | null | undefined): number {
  const base = Math.max(0, safeNumber(gross));
  const value = safeNumber(discountValue);
  if (!isLineDiscountType(discountType) || !(value > 0) || !(base > 0)) return 0;
  const raw = discountType === "percent" ? (base * Math.min(value, 100)) / 100 : value;
  return Math.min(base, Math.max(0, roundMoney(raw)));
}

export function lineNet(price: number, qty: number, discountType?: LineDiscountType | null, discountValue?: number | null): number {
  const gross = lineGross(price, qty);
  return roundMoney(gross - lineDiscountAmount(gross, discountType, discountValue));
}

export function lineHasDiscount(line: Pick<MoneyLine, "discountType" | "discountValue">): boolean {
  return isLineDiscountType(line.discountType) && safeNumber(line.discountValue) > 0;
}

export function computeOrderMoney(input: { services: readonly MoneyLine[]; materials: readonly MoneyLine[] }): OrderMoney {
  let subtotal = 0;
  let discountTotal = 0;
  for (const line of [...input.services, ...input.materials]) {
    const gross = lineGross(line.price, line.qty);
    subtotal += gross;
    discountTotal += lineDiscountAmount(gross, line.discountType, line.discountValue);
  }
  const roundedSubtotal = roundMoney(subtotal);
  const roundedDiscount = roundMoney(discountTotal);
  return { subtotal: roundedSubtotal, discountTotal: roundedDiscount, total: roundMoney(roundedSubtotal - roundedDiscount) };
}

/** Structural subset of `ClientDiscount` (kept local so clientDiscounts.ts can import this module). */
export type ClientDiscountLike = { target: string; mode: string; percent: number | null };

/** The fixed percent (0 when none) the client has for `target` ('service_order', 'product_order', ...). */
export function clientDiscountPercent(discounts: readonly ClientDiscountLike[], target: string): number {
  const discount = discounts.find((item) => item.target === target);
  if (!discount || discount.mode !== "fixed") return 0;
  const percent = Number(discount.percent ?? 0);
  return Number.isFinite(percent) && percent > 0 ? Math.min(percent, 100) : 0;
}

type StampableLine = { id?: string; price?: number; discountType?: LineDiscountType | null; discountValue?: number | null };

/**
 * Applies the client's `service_order` percent to service lines and `product_order` to material lines as
 * `discount_type = 'percent'`. A line that already carries a discount is returned untouched, so a discount
 * can never be applied twice. `skipSaved` additionally leaves lines that already have an `id` alone
 * (edit forms: only NEW lines receive the client discount). Returns new arrays; inputs are not mutated.
 */
export function stampClientDiscountsOnLines<S extends StampableLine, M extends StampableLine>(
  services: readonly S[],
  materials: readonly M[],
  clientDiscounts: readonly ClientDiscountLike[],
  options: { skipSaved?: boolean } = {},
): { services: S[]; materials: M[] } {
  const servicePercent = clientDiscountPercent(clientDiscounts, "service_order");
  const productPercent = clientDiscountPercent(clientDiscounts, "product_order");

  const stamp = <T extends StampableLine>(line: T, percent: number): T => {
    if (!(percent > 0) || lineHasDiscount(line)) return line;
    if (options.skipSaved && line.id) return line;
    return { ...line, discountType: "percent", discountValue: percent };
  };

  return {
    services: services.map((line) => stamp(line, servicePercent)),
    materials: materials.map((line) => stamp(line, productPercent)),
  };
}

/**
 * Header metadata: the single percent shared by every discounted line, or null when there is no discount,
 * a mix of percents or any `amount` line. (`discount_total` stays the authoritative figure.)
 */
export function uniformPercentOf(lines: readonly Pick<MoneyLine, "discountType" | "discountValue">[]): number | null {
  let percent: number | null = null;
  for (const line of lines) {
    if (!lineHasDiscount(line)) continue;
    if (line.discountType !== "percent") return null;
    const value = safeNumber(line.discountValue);
    if (percent === null) percent = value;
    else if (percent !== value) return null;
  }
  return percent;
}
