import { describe, expect, it } from "vitest";
import {
  applyDiscountPercent,
  effectiveDiscountPercent,
  estimateDiscountedTotal,
  findClientDiscount,
  parseDiscountPercent,
  type ClientDiscount,
} from "./clientDiscounts";

const discount = (partial: Partial<ClientDiscount> & Pick<ClientDiscount, "target">): ClientDiscount => ({
  id: partial.target,
  clientId: "c1",
  mode: "fixed",
  percent: 10,
  priceTypeId: null,
  updatedAt: "",
  ...partial,
});

describe("parseDiscountPercent", () => {
  it("parses dot and comma decimals, blank as null", () => {
    expect(parseDiscountPercent("10")).toBe(10);
    expect(parseDiscountPercent(" 7,5 ")).toBe(7.5);
    expect(parseDiscountPercent("")).toBeNull();
    expect(parseDiscountPercent("12.3456")).toBe(12.346);
  });

  it("rejects invalid or out-of-range values", () => {
    expect(parseDiscountPercent("abc")).toBeNaN();
    expect(parseDiscountPercent("-5")).toBeNaN();
    expect(parseDiscountPercent("100.5")).toBeNaN();
    expect(parseDiscountPercent("100")).toBe(100);
  });
});

describe("effectiveDiscountPercent / applyDiscountPercent", () => {
  it("only fixed positive percents reduce prices", () => {
    expect(effectiveDiscountPercent(discount({ target: "service_order", percent: 15 }))).toBe(15);
    expect(effectiveDiscountPercent(discount({ target: "service_order", mode: "price_type", percent: null }))).toBe(0);
    expect(effectiveDiscountPercent(discount({ target: "service_order", percent: 0 }))).toBe(0);
    expect(effectiveDiscountPercent(null)).toBe(0);
  });

  it("rounds to cents and never goes negative", () => {
    expect(applyDiscountPercent(199.99, 10)).toBe(179.99);
    expect(applyDiscountPercent(100, 0)).toBe(100);
    expect(applyDiscountPercent(100, 100)).toBe(0);
    expect(applyDiscountPercent(Number.NaN, 10)).toBe(0);
  });
});

describe("estimateDiscountedTotal", () => {
  it("applies service_order to services and product_order to materials only", () => {
    const discounts = [discount({ target: "service_order", percent: 10 }), discount({ target: "product_sale", percent: 50 })];
    const estimate = estimateDiscountedTotal({ servicesTotal: 200, materialsTotal: 100 }, discounts);
    expect(estimate).toEqual({ servicePercent: 10, productPercent: 0, hasDiscount: true, subtotal: 300, discountTotal: 20, total: 280 });
    expect(findClientDiscount(discounts, "service_order")?.percent).toBe(10);
  });

  it("reports no discount when nothing applies", () => {
    const estimate = estimateDiscountedTotal({ servicesTotal: 50, materialsTotal: 0 }, []);
    expect(estimate.hasDiscount).toBe(false);
    expect(estimate.total).toBe(50);
  });
});
