import { describe, expect, it } from "vitest";
import {
  computeOrderMoney,
  lineDiscountAmount,
  lineGross,
  lineNet,
  roundMoney,
  stampClientDiscountsOnLines,
  uniformPercentOf,
  type MoneyLine,
} from "./orderTotals";

const clientDiscounts = [
  { target: "service_order", mode: "fixed", percent: 10 },
  { target: "product_order", mode: "fixed", percent: 5 },
  { target: "service_sale", mode: "fixed", percent: 50 },
];

describe("roundMoney", () => {
  it("rounds half up to 2 decimals (10.005 -> 10.01)", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(-10.005)).toBe(-10.01);
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe("line math", () => {
  it("gross / discount / net", () => {
    expect(lineGross(19.99, 3)).toBe(59.97);
    expect(lineDiscountAmount(200, "percent", 10)).toBe(20);
    expect(lineDiscountAmount(200, "amount", 15)).toBe(15);
    expect(lineNet(100, 2, "percent", 25)).toBe(150);
    expect(lineNet(100, 2)).toBe(200);
  });

  it("100% discount makes the line free", () => {
    expect(lineDiscountAmount(80, "percent", 100)).toBe(80);
    expect(lineNet(40, 2, "percent", 100)).toBe(0);
    expect(lineDiscountAmount(80, "percent", 250)).toBe(80);
  });

  it("amount larger than gross is capped at gross; never negative", () => {
    expect(lineDiscountAmount(50, "amount", 500)).toBe(50);
    expect(lineNet(50, 1, "amount", 500)).toBe(0);
    expect(lineDiscountAmount(50, "amount", -5)).toBe(0);
    expect(lineDiscountAmount(50, "percent", -10)).toBe(0);
    expect(lineDiscountAmount(-50, "percent", 10)).toBe(0);
    expect(lineDiscountAmount(50, null, 10)).toBe(0);
  });

  it("rounds the percent discount to cents", () => {
    expect(lineDiscountAmount(33.33, "percent", 10)).toBe(3.33);
    expect(lineDiscountAmount(10.05, "percent", 50)).toBe(5.03);
  });
});

describe("computeOrderMoney", () => {
  it("creation math: subtotal, discountTotal, total", () => {
    const services: MoneyLine[] = [
      { price: 100, qty: 2, discountType: "percent", discountValue: 10 },
      { price: 50, qty: 1 },
    ];
    const materials: MoneyLine[] = [{ price: 20, qty: 3, discountType: "amount", discountValue: 5 }];
    expect(computeOrderMoney({ services, materials })).toEqual({ subtotal: 310, discountTotal: 25, total: 285 });
  });

  it("empty order is all zeros", () => {
    expect(computeOrderMoney({ services: [], materials: [] })).toEqual({ subtotal: 0, discountTotal: 0, total: 0 });
  });

  it("edit recalculation follows changed qty / price / lines", () => {
    const before = computeOrderMoney({ services: [{ price: 100, qty: 1, discountType: "percent", discountValue: 10 }], materials: [] });
    expect(before).toEqual({ subtotal: 100, discountTotal: 10, total: 90 });

    const after = computeOrderMoney({
      services: [{ price: 100, qty: 3, discountType: "percent", discountValue: 10 }],
      materials: [{ price: 40, qty: 1 }],
    });
    expect(after).toEqual({ subtotal: 340, discountTotal: 30, total: 310 });
  });

  it("rounding: a 10.005 line is rounded once, and the total adds up to the cent", () => {
    const money = computeOrderMoney({ services: [{ price: 10.005, qty: 1 }], materials: [] });
    expect(money).toEqual({ subtotal: 10.01, discountTotal: 0, total: 10.01 });
  });

  it("100% discount gives a zero total", () => {
    const money = computeOrderMoney({
      services: [{ price: 120, qty: 1, discountType: "percent", discountValue: 100 }],
      materials: [{ price: 30, qty: 2, discountType: "percent", discountValue: 100 }],
    });
    expect(money).toEqual({ subtotal: 180, discountTotal: 180, total: 0 });
  });

  it("amount above gross is capped per line, never driving the total negative", () => {
    const money = computeOrderMoney({
      services: [{ price: 30, qty: 1, discountType: "amount", discountValue: 1000 }],
      materials: [{ price: 70, qty: 1 }],
    });
    expect(money).toEqual({ subtotal: 100, discountTotal: 30, total: 70 });
  });
});

describe("stampClientDiscountsOnLines", () => {
  it("applies service_order to services and product_order to materials as percent", () => {
    const stamped = stampClientDiscountsOnLines([{ price: 100, qty: 1 }], [{ price: 40, qty: 1 }], clientDiscounts);
    expect(stamped.services[0]).toMatchObject({ discountType: "percent", discountValue: 10 });
    expect(stamped.materials[0]).toMatchObject({ discountType: "percent", discountValue: 5 });
    expect(computeOrderMoney({ services: stamped.services, materials: stamped.materials })).toEqual({ subtotal: 140, discountTotal: 12, total: 128 });
  });

  it("never double-stamps a line that already has a discount", () => {
    const first = stampClientDiscountsOnLines([{ price: 100, qty: 1 }], [{ price: 40, qty: 1 }], clientDiscounts);
    const second = stampClientDiscountsOnLines(first.services, first.materials, clientDiscounts);
    expect(second.services[0]).toBe(first.services[0]);
    expect(second.materials[0]).toBe(first.materials[0]);

    const custom = stampClientDiscountsOnLines([{ price: 100, qty: 1, discountType: "amount" as const, discountValue: 7 }], [], clientDiscounts);
    expect(custom.services[0]).toMatchObject({ discountType: "amount", discountValue: 7 });
  });

  it("skips non-fixed / zero / unrelated targets and does not mutate inputs", () => {
    const services = [{ price: 10, qty: 1 }];
    const none = stampClientDiscountsOnLines(
      services,
      [],
      [
        { target: "service_order", mode: "price_type", percent: null },
        { target: "product_order", mode: "fixed", percent: 0 },
        { target: "service_sale", mode: "fixed", percent: 30 },
      ],
    );
    expect(none.services[0]).toBe(services[0]);
    expect(services[0]).toEqual({ price: 10, qty: 1 });
  });

  it("skipSaved leaves saved lines alone (edit: only new lines get stamped)", () => {
    const stamped = stampClientDiscountsOnLines([{ id: "s1", price: 10, qty: 1 }, { price: 10, qty: 1 }], [], clientDiscounts, { skipSaved: true });
    expect(stamped.services[0]).not.toHaveProperty("discountType");
    expect(stamped.services[1]).toMatchObject({ discountType: "percent", discountValue: 10 });
  });
});

describe("uniformPercentOf", () => {
  it("returns the shared percent only when it is unambiguous", () => {
    expect(uniformPercentOf([{ discountType: "percent", discountValue: 10 }, { discountType: null }])).toBe(10);
    expect(uniformPercentOf([{ discountType: "percent", discountValue: 10 }, { discountType: "percent", discountValue: 5 }])).toBeNull();
    expect(uniformPercentOf([{ discountType: "percent", discountValue: 10 }, { discountType: "amount", discountValue: 3 }])).toBeNull();
    expect(uniformPercentOf([{ discountType: null }])).toBeNull();
  });
});
