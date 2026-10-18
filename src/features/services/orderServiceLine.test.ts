import { describe, expect, it } from "vitest";
import { catalogServiceToOrderLine, orderLineAmount, sumOrderServiceLines } from "./orderServiceLine";

describe("catalogServiceToOrderLine", () => {
  it("snapshots the catalog name and price onto a new order line", () => {
    expect(
      catalogServiceToOrderLine({
        id: "svc-1",
        service_name: "Oil change",
        service_price: 40,
      }),
    ).toEqual({
      serviceId: "svc-1",
      serviceName: "Oil change",
      price: 40,
      quantity: 1,
    });
  });

  it("keeps the order-line price when the catalog price later changes", () => {
    const catalog = { id: "svc-1", service_name: "Oil change", service_price: 40 };
    const line = catalogServiceToOrderLine(catalog);

    catalog.service_price = 99;

    expect(line.price).toBe(40);
    expect(catalog.service_price).toBe(99);
  });

  it("treats a missing catalog price as zero on the snapshot", () => {
    expect(catalogServiceToOrderLine({ id: "svc-2", service_name: "Wash", service_price: undefined as unknown as number }).price).toBe(0);
  });
});

describe("order line totals", () => {
  it("multiplies unit price by quantity for a line amount", () => {
    expect(orderLineAmount({ price: 40, quantity: 2 })).toBe(80);
    expect(orderLineAmount({ price: 25, quantity: 1 })).toBe(25);
  });

  it("sums line amounts for the order total", () => {
    expect(
      sumOrderServiceLines([
        { price: 40, quantity: 2 },
        { price: 15, quantity: 1 },
      ]),
    ).toBe(95);
    expect(sumOrderServiceLines(undefined)).toBe(0);
  });
});
