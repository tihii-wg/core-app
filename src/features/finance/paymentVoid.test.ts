import { describe, expect, it } from "vitest";
import {
  assessDeleteFullyVoidedPayment,
  assessErroneousPaymentVoid,
  PAYMENT_VOID_SCHEMA_SUPPORTED,
  validatePaymentVoidReason,
} from "./paymentVoid";
import { isFullyVoidedPayment, netCollected, orderPaymentBalance, refundableRemaining } from "./paymentCalculations";
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
  it("allows void when schema support is enabled and the payment is clean", () => {
    expect(PAYMENT_VOID_SCHEMA_SUPPORTED).toBe(true);
    const row = payment();
    expect(assessErroneousPaymentVoid(row, [row])).toEqual({ allowed: true });
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

describe("assessDeleteFullyVoidedPayment", () => {
  it("allows cleanup only after a full void with no refunds", () => {
    const original = payment({ id: "pay-1", amount: 100 });
    const voidRow = payment({
      id: "void-1",
      kind: "void",
      amount: 100,
      relatedPaymentId: "pay-1",
    });
    expect(isFullyVoidedPayment(original, [original, voidRow])).toBe(true);
    expect(assessDeleteFullyVoidedPayment(original, [original, voidRow])).toEqual({ allowed: true });
    expect(assessDeleteFullyVoidedPayment(original, [original])).toEqual({
      allowed: false,
      reason: "not_fully_voided",
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
  it("keeps refunds as money return and voids as erroneous offsets", () => {
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

    const clean = payment({ id: "pay-2", amount: 50, orderId: "ord-1" });
    expect(assessErroneousPaymentVoid(clean, [clean])).toEqual({ allowed: true });
  });
});
