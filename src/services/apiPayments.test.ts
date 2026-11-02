import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteFullyVoidedPayment,
  mapDeleteFullyVoidedPaymentError,
  mapPaymentDbError,
  mapVoidInsertDbError,
  PAYMENT_VOID_SQL,
  PaymentsUnavailableError,
} from "./apiPayments";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from,
    rpc,
  },
}));

describe("mapPaymentDbError", () => {
  it("maps missing-table codes to PaymentsUnavailableError", () => {
    expect(mapPaymentDbError({ code: "PGRST205", message: "missing" })).toBeInstanceOf(PaymentsUnavailableError);
    expect(mapPaymentDbError({ code: "42P01", message: "missing" })).toBeInstanceOf(PaymentsUnavailableError);
  });

  it("maps trigger validation prefixes to localized finance errors", () => {
    expect(mapPaymentDbError({ message: "payments_validation:payment_exceeds_remaining" }).message).toMatch(/exceed/i);
    expect(mapPaymentDbError({ message: "payments_validation:workspace_mismatch" }).message).toMatch(/workspace/i);
    expect(mapPaymentDbError({ message: "payments_validation:currency_mismatch" }).message).toMatch(/currency/i);
    expect(mapPaymentDbError({ message: "payments_validation:currency_mixed" }).message).toMatch(/more than one currency|разных валютах|mai multe monede/i);
    expect(mapPaymentDbError({ message: "payments_validation:currency_format" }).message).toMatch(/three-letter|trei litere|трёхбуквен/i);
    expect(mapPaymentDbError({ message: "payments_validation:workspace_currency_invalid" }).message).toMatch(/billing currency|monedă de facturare|валюты биллинга/i);
    expect(mapPaymentDbError({ message: "payments_validation:invoice_order_changed_retry" }).message).toMatch(/try again|Încercați din nou|Повторите попытку/i);
    expect(mapPaymentDbError({ code: "40001", message: "could not serialize" }).message).toMatch(/try again|Încercați din nou|Повторите попытку/i);
    expect(mapPaymentDbError({ message: "payments_validation:refund_against_refund" }).message).toMatch(/refund/i);
    expect(mapPaymentDbError({ code: "42501", message: "denied" }).message).toMatch(/permission/i);
  });

  it("keeps payment-method validation for create/refund paths", () => {
    expect(mapPaymentDbError({ message: "payments_validation:method_invalid" }).message).toMatch(
      /payment method|способ оплаты|metodă de plată/i,
    );
  });

  it("falls back to the server message for unknown failures", () => {
    expect(mapPaymentDbError({ message: "boom" }).message).toBe("boom");
  });
});

describe("mapVoidInsertDbError", () => {
  it("maps kind_invalid and payments_kind_check to the void schema message", () => {
    expect(mapVoidInsertDbError({ message: "payments_validation:kind_invalid" }).message).toMatch(
      new RegExp(PAYMENT_VOID_SQL.replace(".", "\\.")),
    );
    expect(mapVoidInsertDbError({ code: "23514", message: "violates check constraint payments_kind_check" }).message).toMatch(
      new RegExp(PAYMENT_VOID_SQL.replace(".", "\\.")),
    );
  });

  it("does not claim SQL is missing when void schema is supported and method_invalid is a real method error", () => {
    // PAYMENT_VOID_SCHEMA_SUPPORTED is true after void SQL; method_invalid is payment_method validation.
    const error = mapVoidInsertDbError({
      code: "23514",
      message: "payments_validation:method_invalid",
    });
    expect(error.message).not.toMatch(new RegExp(PAYMENT_VOID_SQL.replace(".", "\\.")));
    expect(error.message).toMatch(/payment method|способ оплаты|metodă de plată/i);
  });

  it("does not treat unrelated check failures (bare 23514) as missing void SQL", () => {
    const error = mapVoidInsertDbError({
      code: "23514",
      message: 'new row for relation "payments" violates check constraint "payments_payment_method_check"',
    });
    expect(error.message).not.toMatch(new RegExp(PAYMENT_VOID_SQL.replace(".", "\\.")));
  });
});

describe("mapDeleteFullyVoidedPaymentError", () => {
  it("never surfaces payment-method validation on delete", () => {
    const error = mapDeleteFullyVoidedPaymentError({
      message: "payments_validation:method_invalid",
    });
    expect(error.message).not.toMatch(/payment method|способ оплаты|metodă de plată/i);
    expect(error.message).toMatch(/could not delete|не удалось удалить|nu s-a putut șterge/i);
  });

  it("maps dependency blockers to the actual delete reasons", () => {
    expect(
      mapDeleteFullyVoidedPaymentError({
        message: "Cannot delete payment: refund rows still reference it. Resolve refunds first.",
      }).message,
    ).toMatch(/refund/i);
    expect(
      mapDeleteFullyVoidedPaymentError({
        message: "Cannot delete payment: it is not fully marked erroneous (void). Void it in Finance first.",
      }).message,
    ).toMatch(/fully|полного|complet/i);
  });
});

describe("deleteFullyVoidedPayment", () => {
  const paymentRow = {
    id: "pay-1",
    workspace_id: "ws-1",
    order_id: "ord-1",
    invoice_id: "inv-1",
    related_payment_id: null,
    kind: "payment",
    amount: 100,
    currency_code: "MDL",
    payment_method: "cash",
    paid_at: "2026-03-01T12:00:00.000Z",
    note: "",
    created_by: null,
    created_at: "2026-03-01T12:00:00.000Z",
  };

  const voidRow = {
    ...paymentRow,
    id: "void-1",
    kind: "void",
    related_payment_id: "pay-1",
    note: "mistyped entry",
  };

  function paymentsQuery(rows: unknown[]) {
    const insert = vi.fn();
    const chain: Record<string, unknown> = {};
    let orderCount = 0;
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => {
      orderCount += 1;
      if (orderCount >= 2) return Promise.resolve({ data: rows, error: null });
      return chain;
    };
    chain.maybeSingle = () => Promise.resolve({ data: paymentRow, error: null });
    chain.insert = insert;
    return { chain, insert };
  }

  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("deletes an eligible fully voided payment via RPC without payment-method validation", async () => {
    const { chain, insert } = paymentsQuery([paymentRow, voidRow]);
    from.mockImplementation(() => chain);
    rpc.mockResolvedValue({ data: null, error: null });

    await expect(deleteFullyVoidedPayment("pay-1", "ws-1")).resolves.toEqual({ paymentId: "pay-1" });

    expect(rpc).toHaveBeenCalledWith("delete_fully_voided_payment", { p_payment_id: "pay-1" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not map delete RPC failures to payment-method validation", async () => {
    const { chain } = paymentsQuery([paymentRow, voidRow]);
    from.mockImplementation(() => chain);
    rpc.mockResolvedValue({
      data: null,
      error: { message: "payments_validation:method_invalid", code: "23514" },
    });

    await expect(deleteFullyVoidedPayment("pay-1", "ws-1")).rejects.toThrow(
      /could not delete|не удалось удалить|nu s-a putut șterge/i,
    );
  });
});
