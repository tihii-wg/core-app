import { describe, expect, it } from "vitest";
import { mapPaymentDbError, PaymentsUnavailableError } from "./apiPayments";

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

  it("falls back to the server message for unknown failures", () => {
    expect(mapPaymentDbError({ message: "boom" }).message).toBe("boom");
  });
});
