import { describe, expect, it } from "vitest";
import type { InvoiceItem } from "../../lib/types";
import { classifyInvoiceItems, type InvoiceOrderLines } from "./invoiceItemSections";

function item(partial: Partial<InvoiceItem> & Pick<InvoiceItem, "serviceName" | "price" | "quantity" | "position">): InvoiceItem {
  return {
    id: `item-${partial.position}`,
    invoiceId: "invoice-1",
    serviceId: null,
    createdAt: "2026-10-04",
    ...partial,
  };
}

const orderLines: InvoiceOrderLines = {
  services: [
    { serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 },
    { serviceId: null, serviceName: "Custom diagnostic", price: 10, quantity: 2 },
  ],
  materials: [{ itemName: "Oil filter", price: 15, quantity: 2 }],
};

describe("classifyInvoiceItems", () => {
  it("classifies catalog services as works and null-serviceId lines after them as materials", () => {
    const sections = classifyInvoiceItems([
      item({ serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1, position: 0 }),
      item({ serviceName: "Oil filter", price: 15, quantity: 2, position: 1 }),
    ]);
    expect(sections.works.map((entry) => entry.serviceName)).toEqual(["Oil change"]);
    expect(sections.materials.map((entry) => entry.serviceName)).toEqual(["Oil filter"]);
  });

  it("uses the source order to rescue a null-serviceId service line (snapshot order)", () => {
    const sections = classifyInvoiceItems(
      [
        item({ serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1, position: 0 }),
        item({ serviceName: "Custom diagnostic", price: 10, quantity: 2, position: 1 }),
        item({ serviceName: "Oil filter", price: 15, quantity: 2, position: 2 }),
      ],
      orderLines,
    );
    expect(sections.works.map((entry) => entry.serviceName)).toEqual(["Oil change", "Custom diagnostic"]);
    expect(sections.materials.map((entry) => entry.serviceName)).toEqual(["Oil filter"]);
  });

  it("keeps separate subtotals and a grand total counted exactly once", () => {
    const sections = classifyInvoiceItems(
      [
        item({ serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1, position: 0 }),
        item({ serviceName: "Custom diagnostic", price: 10, quantity: 2, position: 1 }),
        item({ serviceName: "Oil filter", price: 15, quantity: 2, position: 2 }),
      ],
      orderLines,
    );
    expect(sections.worksSubtotal).toBe(60);
    expect(sections.materialsSubtotal).toBe(30);
    expect(sections.grandTotal).toBe(90);
    expect(sections.works.length + sections.materials.length).toBe(3);
  });

  it("handles empty works and empty materials sections", () => {
    const materialsOnly = classifyInvoiceItems([item({ serviceName: "Brake pads", price: 25, quantity: 1, position: 0 })]);
    expect(materialsOnly.works).toEqual([]);
    expect(materialsOnly.materialsSubtotal).toBe(25);
    expect(materialsOnly.grandTotal).toBe(25);

    const worksOnly = classifyInvoiceItems([item({ serviceId: "svc-1", serviceName: "Labour", price: 50, quantity: 2, position: 0 })]);
    expect(worksOnly.materials).toEqual([]);
    expect(worksOnly.worksSubtotal).toBe(100);
    expect(worksOnly.grandTotal).toBe(100);

    const empty = classifyInvoiceItems([]);
    expect(empty).toEqual({ works: [], materials: [], worksSubtotal: 0, materialsSubtotal: 0, grandTotal: 0 });
  });

  it("falls back to the service_id marker when the source order is unavailable", () => {
    const sections = classifyInvoiceItems([
      item({ serviceId: "svc-1", serviceName: "Labour", price: 50, quantity: 1, position: 0 }),
      item({ serviceName: "Oil filter", price: 15, quantity: 1, position: 1 }),
    ]);
    expect(sections.works.map((entry) => entry.serviceName)).toEqual(["Labour"]);
    expect(sections.materials.map((entry) => entry.serviceName)).toEqual(["Oil filter"]);
  });

  it("preserves persisted price and quantity (no re-pricing)", () => {
    const sections = classifyInvoiceItems([
      item({ serviceId: "svc-1", serviceName: "Labour", price: 33.33, quantity: 3, position: 0 }),
    ]);
    expect(sections.worksSubtotal).toBe(99.99);
    expect(sections.grandTotal).toBe(99.99);
  });
});
