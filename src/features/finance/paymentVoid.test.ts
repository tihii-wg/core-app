import { describe, expect, it } from "vitest";
import {
  assessErroneousPaymentVoid,
  PAYMENT_VOID_SCHEMA_SUPPORTED,
  validatePaymentVoidReason,
} from "./paymentVoid";
import { netCollected, orderPaymentBalance, refundableRemaining } from "./paymentCalculations";
import type { LedgerPayment } from "./paymentTypes";

function payment(overrides: Partial<LedgerPayment> = {}): LedgerPayment {
  return {
    id: "pay-1",
    workspaceId: "ws-1",
    orderId: "ord-1",
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    amount: 100,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-03-01T12:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-03-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("assessErroneousPaymentVoid", () => {
  it("blocks void while schema support is missing (no inventing void rows)", () => {
    expect(PAYMENT_VOID_SCHEMA_SUPPORTED).toBe(false);
    const row = payment();
    expect(assessErroneousPaymentVoid(row, [row])).toEqual({
      allowed: false,
      reason: "schema_unsupported",
    });
  });

  it("rejects voiding refund rows and already-offset payments", () => {
    const original = payment({ id: "pay-1", amount: 80 });
    const refund = payment({
      id: "ref-1",
      kind: "refund",
      amount: 30,
      relatedPaymentId: "pay-1",
    });
    expect(assessErroneousPaymentVoid(refund, [original, refund])).toEqual({
      allowed: false,
      reason: "not_a_payment",
    });
    expect(assessErroneousPaymentVoid(original, [original, refund])).toEqual({
      allowed: false,
      reason: "already_offset",
    });
  });

  it("rejects void when the user cannot record payments", () => {
    const row = payment();
    expect(assessErroneousPaymentVoid(row, [row], { canRecord: false })).toEqual({
      allowed: false,
      reason: "no_permission",
    });
  });
});

describe("validatePaymentVoidReason", () => {
  it("requires a reason of at least 8 characters", () => {
    expect(validatePaymentVoidReason("")).toBe("required");
    expect(validatePaymentVoidReason("   ")).toBe("required");
    expect(validatePaymentVoidReason("short")).toBe("too_short");
    expect(validatePaymentVoidReason("mistyped entry")).toBeNull();
  });
});

describe("real payment refund vs erroneous void (balances)", () => {
  it("keeps refunds as the only supported offset and recalculates balances", () => {
    const original = payment({ id: "pay-1", amount: 100, orderId: "ord-1" });
    const refund = payment({
      id: "ref-1",
      kind: "refund",
      amount: 40,
      relatedPaymentId: "pay-1",
      orderId: "ord-1",
    });
    const rows = [original, refund];

    expect(refundableRemaining(original, rows)).toBe(60);
    expect(netCollected(rows)).toBe(60);
    expect(
      orderPaymentBalance({ id: "ord-1", totalPrice: 100, isPaid: false, status: "new" }, rows),
    ).toMatchObject({ netPaid: 60, remaining: 40, status: "partial", hasLedger: true });

    // Void must not be simulated as an automatic refund — candidate stays schema-blocked.
    expect(assessErroneousPaymentVoid(original, [original])).toEqual({
      allowed: false,
      reason: "schema_unsupported",
    });
  });
});
