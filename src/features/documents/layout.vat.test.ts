import { describe, expect, it } from "vitest";
import { renderLayoutToHtml } from "./layout";
import { emptyPrintContext } from "./templateVariables";
import type { Order } from "../../lib/types";
import { defaultWorkOrderLayout } from "./defaultLayouts";

function order(partial: Partial<Order> = {}): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [{ serviceId: "s1", serviceName: "Work", price: 1200, quantity: 1 }],
    materials: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 1200,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("layout VAT totals", () => {
  it("renders net / vat / gross rows when a VAT rate exists", () => {
    const html = renderLayoutToHtml(
      defaultWorkOrderLayout(),
      emptyPrintContext({
        order: order({ vatRate: 20 }),
        workspaceVatRate: null,
        documentKind: "work_order",
        locale: "ru",
        currency: "MDL",
      }),
      { showCents: true },
    );
    expect(html).toContain("Без НДС");
    expect(html).toMatch(/1[\s\u00a0]?000/);
    expect(html).toMatch(/200/);
    expect(html).toContain("Итого с НДС");
  });

  it("omits VAT totals rows when no rate is available", () => {
    const html = renderLayoutToHtml(
      defaultWorkOrderLayout(),
      emptyPrintContext({
        order: order({ vatRate: null }),
        workspaceVatRate: null,
        documentKind: "work_order",
        locale: "ru",
        currency: "MDL",
      }),
      { showCents: true },
    );
    expect(html).not.toContain("Без НДС");
    expect(html).not.toContain("Итого с НДС");
  });
});
