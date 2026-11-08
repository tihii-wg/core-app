import { describe, expect, it } from "vitest";
import type { Invoice } from "../../lib/types";
import {
  buildInvoiceWorkQueue,
  invoicesForOrder,
  nextCancelChainStep,
} from "./orderCancelChain";

function invoice(partial: Partial<Invoice> & Pick<Invoice, "id" | "invoiceNumber" | "status">): Invoice {
  return {
    workspaceId: "ws-1",
    clientId: "c1",
    clientName: "Ada",
    device: "",
    carNumber: "",
    vin: "",
    description: "",
    subtotal: 100,
    amount: 100,
    total: 100,
    dueDate: "",
    createdAt: partial.createdAt ?? "2026-01-01",
    updatedAt: "",
    orderId: "order-1",
    ...partial,
  };
}

describe("invoicesForOrder / buildInvoiceWorkQueue", () => {
  it("filters by order and sorts oldest-first", () => {
    const rows = [
      invoice({ id: "i2", invoiceNumber: "INV-2", status: "sent", createdAt: "2026-02-01", orderId: "order-1" }),
      invoice({ id: "i1", invoiceNumber: "INV-1", status: "draft", createdAt: "2026-01-01", orderId: "order-1" }),
      invoice({ id: "i3", invoiceNumber: "INV-3", status: "sent", createdAt: "2026-01-15", orderId: "order-2" }),
    ];
    expect(invoicesForOrder(rows, "order-1").map((row) => row.id)).toEqual(["i1", "i2"]);
  });

  it("queues non-erroneous before already-erroneous", () => {
    const queue = buildInvoiceWorkQueue([
      invoice({ id: "e1", invoiceNumber: "E-1", status: "erroneous", createdAt: "2026-01-01" }),
      invoice({ id: "s1", invoiceNumber: "S-1", status: "sent", createdAt: "2026-02-01" }),
    ]);
    expect(queue.map((item) => [item.invoice.id, item.alreadyErroneous])).toEqual([
      ["s1", false],
      ["e1", true],
    ]);
  });
});

describe("nextCancelChainStep", () => {
  const queue = buildInvoiceWorkQueue([
    invoice({ id: "i1", invoiceNumber: "INV-1", status: "sent" }),
    invoice({ id: "i2", invoiceNumber: "INV-2", status: "erroneous" }),
  ]);

  it("starts with annul for non-erroneous invoice", () => {
    expect(
      nextCancelChainStep({
        queue,
        nextIndex: 0,
        capabilities: { canManageInvoices: true, deleteOrderBlockedReason: null },
        noInvoicePermissionReason: "no-inv",
      }),
    ).toMatchObject({ kind: "annul", invoice: { id: "i1" }, index: 1, total: 2 });
  });

  it("preferDeleteForCurrent goes to deleteInvoice for same index", () => {
    expect(
      nextCancelChainStep({
        queue,
        nextIndex: 0,
        preferDeleteForCurrent: true,
        capabilities: { canManageInvoices: true, deleteOrderBlockedReason: null },
        noInvoicePermissionReason: "no-inv",
      }),
    ).toMatchObject({ kind: "deleteInvoice", invoice: { id: "i1" } });
  });

  it("skips annul when invoice already erroneous", () => {
    expect(
      nextCancelChainStep({
        queue,
        nextIndex: 1,
        capabilities: { canManageInvoices: true, deleteOrderBlockedReason: null },
        noInvoicePermissionReason: "no-inv",
      }),
    ).toMatchObject({ kind: "deleteInvoice", invoice: { id: "i2" }, index: 2, total: 2 });
  });

  it("blocks when invoices remain without invoice permission", () => {
    expect(
      nextCancelChainStep({
        queue,
        nextIndex: 0,
        capabilities: { canManageInvoices: false, deleteOrderBlockedReason: null },
        noInvoicePermissionReason: "no-inv",
      }),
    ).toEqual({ kind: "blocked", reason: "no-inv" });
  });

  it("offers delete order when queue is empty and delete is allowed", () => {
    expect(
      nextCancelChainStep({
        queue: [],
        nextIndex: 0,
        capabilities: { canManageInvoices: true, deleteOrderBlockedReason: null },
        noInvoicePermissionReason: "no-inv",
      }),
    ).toEqual({ kind: "deleteOrder" });
  });

  it("blocks delete order with provided reason", () => {
    expect(
      nextCancelChainStep({
        queue: [],
        nextIndex: 0,
        capabilities: { canManageInvoices: true, deleteOrderBlockedReason: "no-delete" },
        noInvoicePermissionReason: "no-inv",
      }),
    ).toEqual({ kind: "blocked", reason: "no-delete" });
  });

  it("order without invoices: cancel then delete order", () => {
    const afterCancel = nextCancelChainStep({
      queue: [],
      nextIndex: 0,
      capabilities: { canManageInvoices: false, deleteOrderBlockedReason: null },
      noInvoicePermissionReason: "no-inv",
    });
    expect(afterCancel).toEqual({ kind: "deleteOrder" });
  });
});
