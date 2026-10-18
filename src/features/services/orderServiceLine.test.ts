import { describe, expect, it } from "vitest";
import { catalogServiceToOrderLine } from "./orderServiceLine";

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
