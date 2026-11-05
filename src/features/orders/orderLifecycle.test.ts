import { describe, expect, it } from "vitest";
import {
  findDefaultOrderStatus,
  isNormalWorkflowStatus,
  isOrderCurrentlyClosed,
  isOrderFormallyClosed,
  parseLifecycleRpcError,
  resolveWarrantyStartAt,
} from "./orderLifecycle";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import type { LedgerPayment } from "../finance/paymentTypes";

function definition(partial: Partial<StatusDefinition> & Pick<StatusDefinition, "id" | "name">): StatusDefinition {
  return {
    workspaceId: "ws",
    entity: "order",
    color: "#000",
    statusGroup: "new",
    systemStatus: "new",
    code: null,
    semanticAction: "normal",
    sortOrder: 0,
    isDefault: false,
    isActive: true,
    showOverdueBadge: false,
    addsToBackorders: false,
    ...partial,
  };
}

function payment(partial: Partial<LedgerPayment> & Pick<LedgerPayment, "id" | "amount" | "kind">): LedgerPayment {
  return {
    workspaceId: "ws",
    orderId: "o1",
    invoiceId: null,
    relatedPaymentId: null,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-01-01T00:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("orderLifecycle", () => {
  it("parses not_settled remaining and currency from RPC errors", () => {
    expect(parseLifecycleRpcError("order_lifecycle:not_settled remaining=42.50 currency=MDL")).toEqual({
      code: "not_settled",
      remaining: 42.5,
      currency: "MDL",
    });
  });

  it("treats only normal active statuses as workflow steps", () => {
    expect(isNormalWorkflowStatus(definition({ id: "1", name: "QA", semanticAction: "normal" }))).toBe(true);
    expect(isNormalWorkflowStatus(definition({ id: "2", name: "Закрыт", semanticAction: "close" }))).toBe(false);
    expect(isNormalWorkflowStatus(definition({ id: "3", name: "X", isActive: false }))).toBe(false);
  });

  it("picks the default normal status, not a close-named status", () => {
    const list = [
      definition({ id: "c", name: "Закрыт", semanticAction: "close", isDefault: true }),
      definition({ id: "n", name: "Новый", isDefault: true, code: "new" }),
    ];
    // close cannot be default in product rules; finder only considers normal
    expect(findDefaultOrderStatus(list)?.id).toBe("n");
  });

  it("formal close uses closedAt; cancel does not activate warranty via closed_at", () => {
    expect(isOrderFormallyClosed({ status: "closed", closedAt: "2026-01-02T00:00:00.000Z" })).toBe(true);
    expect(isOrderFormallyClosed({ status: "in-progress", closedAt: null })).toBe(false);
    expect(
      resolveWarrantyStartAt({ status: "cancelled", createdAt: "2026-01-01", closedAt: null }, "closed_at"),
    ).toBeNull();
    expect(
      resolveWarrantyStartAt(
        { status: "closed", createdAt: "2026-01-01", closedAt: "2026-01-05T12:00:00.000Z" },
        "closed_at",
      ),
    ).toBe("2026-01-05T12:00:00.000Z");
  });

  it("current closure banner requires live status=closed, not a historical closed_at alone", () => {
    const closedAt = "2026-11-05T14:59:54.258807+00:00";
    expect(isOrderCurrentlyClosed({ status: "closed", closedAt })).toBe(true);
    expect(isOrderCurrentlyClosed({ status: "cancelled", closedAt })).toBe(false);
    expect(isOrderCurrentlyClosed({ status: "in-progress", closedAt })).toBe(false);
    expect(isOrderCurrentlyClosed({ status: "closed", closedAt: null })).toBe(false);
    // Auth/history still sees formal closure after cancel/reopen.
    expect(isOrderFormallyClosed({ status: "cancelled", closedAt })).toBe(true);
    expect(isOrderFormallyClosed({ status: "in-progress", closedAt })).toBe(true);
  });

  it("does not double-count order+invoice linked payments", () => {
    const rows = [
      payment({ id: "p1", amount: 40, kind: "payment", orderId: "o1", invoiceId: "inv1" }),
      payment({ id: "p2", amount: 10, kind: "refund", orderId: "o1", invoiceId: "inv1" }),
    ];
    const balance = orderPaymentBalance({ id: "o1", totalPrice: 100, isPaid: false, status: "in-progress" }, rows, "inv1");
    expect(balance.netPaid).toBe(30);
    expect(balance.remaining).toBe(70);
  });

  it("subtracts voids from net collected like refunds", () => {
    const rows = [
      payment({ id: "p1", amount: 100, kind: "payment", orderId: "o1" }),
      payment({ id: "v1", amount: 100, kind: "void", orderId: "o1", relatedPaymentId: "p1" }),
    ];
    const balance = orderPaymentBalance({ id: "o1", totalPrice: 100, isPaid: true, status: "paid" }, rows);
    expect(balance.hasLedger).toBe(true);
    expect(balance.remaining).toBe(100);
  });

  it("keeps outstanding visible after close when a refund reduces net", () => {
    const rows = [
      payment({ id: "p1", amount: 100, kind: "payment", orderId: "o1" }),
      payment({ id: "r1", amount: 20, kind: "refund", orderId: "o1", relatedPaymentId: "p1" }),
    ];
    const balance = orderPaymentBalance({ id: "o1", totalPrice: 100, isPaid: false, status: "closed" }, rows);
    expect(balance.remaining).toBe(20);
    expect(isOrderFormallyClosed({ status: "closed", closedAt: "2026-01-02T00:00:00.000Z" })).toBe(true);
  });

  it("a custom status named Closed does not imply formal closure without closedAt", () => {
    expect(isOrderFormallyClosed({ status: "in-progress", closedAt: null })).toBe(false);
    expect(
      isNormalWorkflowStatus(definition({ id: "x", name: "Закрыт", semanticAction: "normal" })),
    ).toBe(true);
  });

  it("zero-value orders have no remaining even without ledger rows", () => {
    const balance = orderPaymentBalance({ id: "o0", totalPrice: 0, isPaid: false, status: "new" }, []);
    expect(balance.remaining).toBe(0);
    expect(balance.hasLedger).toBe(false);
  });

  it("fully paid orders settle within money tolerance", () => {
    const rows = [payment({ id: "p1", amount: 100, kind: "payment", orderId: "o1" })];
    const balance = orderPaymentBalance({ id: "o1", totalPrice: 100, isPaid: false, status: "in-progress" }, rows);
    expect(balance.remaining).toBe(0);
    expect(balance.hasLedger).toBe(true);
  });

  it("unpaid positive orders still have remaining", () => {
    const balance = orderPaymentBalance({ id: "o1", totalPrice: 50, isPaid: false, status: "new" }, []);
    expect(balance.remaining).toBe(50);
  });
});
