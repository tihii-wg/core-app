import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { buildOrderColumns } from "./buildOrderColumns";

function order(partial: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    workspaceId: "ws-1",
    orderNumber: "ORD-1",
    clientId: "client-1",
    clientName: "Ada",
    clientType: null,
    clientPhone: "",
    device: "BMW",
    carNumber: "",
    vin: "",
    service: "",
    description: "",
    status: "new",
    paymentStatus: "unpaid",
    isPaid: false,
    totalPrice: 100,
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    services: [],
    materials: [],
    ...partial,
  } as Order;
}

describe("buildOrderColumns status / payment", () => {
  const t = ((key: string) => key) as never;

  function columns() {
    return buildOrderColumns({
      t,
      deviceServiceColumn: "Device",
      formatMoney: (value) => `$${value}`,
      today: "2026-11-11",
      warrantyByOrderId: new Map(),
      paymentStatusByOrder: new Map([["order-1", "partial"]]),
      invoiceNumberByOrder: new Map(),
      paymentCountByOrder: new Map(),
      invoicesUnavailable: false,
      isCreatingInvoice: false,
      isStatusUpdating: false,
      requireTaxInvoiceNumber: false,
      onOpenClient: vi.fn(),
      onView: vi.fn(),
      onEdit: vi.fn(),
      onStatusChange: vi.fn(),
      onCreateInvoice: vi.fn(),
      onOrderUpdated: vi.fn(),
      onDeleted: vi.fn(),
    });
  }

  it("has a Status / Payment column and no standalone Payment column", () => {
    const keys = columns().map((column) => column.key);
    expect(keys).toContain("status");
    expect(keys).not.toContain("payment");
    expect(columns().find((column) => column.key === "status")?.header).toBe("orders.table.statusPayment");
  });

  it("keeps the combined order + payment status cell unchanged", () => {
    const statusColumn = columns().find((column) => column.key === "status");
    expect(statusColumn).toBeDefined();
    const cell = statusColumn!.cell(order({ status: "in-progress", paymentStatus: "unpaid" }));
    // Combined stack: order status badge above payment status badge.
    expect(cell).toMatchObject({
      type: "div",
      props: {
        className: expect.stringContaining("flex-col"),
        children: expect.arrayContaining([
          expect.objectContaining({ type: expect.any(Function) }),
          expect.objectContaining({ type: expect.any(Function) }),
        ]),
      },
    });
  });
});
