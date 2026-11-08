import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import type { LedgerPayment } from "../finance/paymentTypes";
import {
  activePaymentsBlockingOrderDelete,
  fullyVoidedPaymentsRemovableOnDelete,
  orderHasCancelSemantic,
  refundsBlockingOrderDelete,
} from "./orderDeletionEligibility";

const order = (partial: Partial<Pick<Order, "status" | "customStatusId">> = {}): Pick<Order, "status" | "customStatusId"> => ({
  status: partial.status ?? "new",
  customStatusId: partial.customStatusId ?? null,
});

const definition = (partial: Partial<StatusDefinition> & Pick<StatusDefinition, "id" | "semanticAction">): StatusDefinition => ({
  id: partial.id,
  workspaceId: "ws-1",
  entity: "order",
  name: partial.name ?? "Status",
  color: null,
  statusGroup: "new",
  systemStatus: partial.systemStatus ?? null,
  code: null,
  semanticAction: partial.semanticAction,
  sortOrder: 0,
  isDefault: false,
  isActive: true,
  showOverdueBadge: false,
  addsToBackorders: false,
  minPaidPercent: null,
});

const payment = (partial: Partial<LedgerPayment> & Pick<LedgerPayment, "id" | "kind" | "amount">): LedgerPayment => ({
  id: partial.id,
  workspaceId: "ws-1",
  orderId: partial.orderId ?? "order-1",
  invoiceId: partial.invoiceId ?? null,
  relatedPaymentId: partial.relatedPaymentId ?? null,
  kind: partial.kind,
  amount: partial.amount,
  currencyCode: "MDL",
  paymentMethod: "cash",
  paidAt: "2026-11-01T10:00:00Z",
  note: "",
  createdBy: null,
  createdAt: "2026-11-01T10:00:00Z",
});

describe("orderHasCancelSemantic", () => {
  it("accepts system cancelled status", () => {
    expect(orderHasCancelSemantic(order({ status: "cancelled" }))).toBe(true);
  });

  it("accepts a definition with cancel semantic action", () => {
    const defs = [definition({ id: "d-cancel", name: "Dropped", semanticAction: "cancel" })];
    expect(orderHasCancelSemantic(order({ status: "in-progress", customStatusId: "d-cancel" }), defs)).toBe(true);
  });

  it("rejects a custom status named Cancelled without cancel semantics", () => {
    const defs = [definition({ id: "d-fake", name: "Cancelled", semanticAction: "normal", systemStatus: "in-progress" })];
    expect(orderHasCancelSemantic(order({ status: "in-progress", customStatusId: "d-fake" }), defs)).toBe(false);
    expect(orderHasCancelSemantic(order({ status: "new" }), defs)).toBe(false);
  });
});

describe("financial blockers for order delete", () => {
  it("blocks active payments and refunds but allows fully voided originals", () => {
    const original = payment({ id: "p1", kind: "payment", amount: 100 });
    const voidRow = payment({ id: "v1", kind: "void", amount: 100, relatedPaymentId: "p1" });
    const refund = payment({ id: "r1", kind: "refund", amount: 40, relatedPaymentId: "p2" });
    const active = payment({ id: "p2", kind: "payment", amount: 40 });

    expect(activePaymentsBlockingOrderDelete([original, voidRow], "order-1")).toEqual([]);
    expect(fullyVoidedPaymentsRemovableOnDelete([original, voidRow], "order-1").map((row) => row.id)).toEqual(["p1"]);
    expect(activePaymentsBlockingOrderDelete([active, refund], "order-1").map((row) => row.id).sort()).toEqual(["p2", "r1"]);
    expect(refundsBlockingOrderDelete([active, refund], "order-1")).toHaveLength(1);
  });
});
