import { describe, expect, it } from "vitest";
import {
  isAcceptedPaymentsAmountCheck,
  isAcceptedPaymentsCurrencyCodeFormatCheck,
  isAcceptedPaymentsKindCheck,
  isAcceptedPaymentsPaymentMethodCheck,
  kindCheckAllowlist,
  normalizePgCheckDef,
  paymentMethodCheckAllowlist,
  PAYMENTS_ENFORCE_INTEGRITY_MANAGED_MARKER,
} from "./paymentLedgerSqlGuards";

describe("managed function marker", () => {
  it("uses the versioned COMMENT string expected by harden_payment_ledger.sql", () => {
    expect(PAYMENTS_ENFORCE_INTEGRITY_MANAGED_MARKER).toBe(
      "managed-object: core-app/payments_enforce_integrity@v1",
    );
  });
});

describe("normalizePgCheckDef", () => {
  it("strips whitespace and casts", () => {
    expect(normalizePgCheckDef("CHECK ((amount > (0)::numeric))")).toBe("check((amount>(0)))");
    expect(normalizePgCheckDef("CHECK ((kind = ANY (ARRAY['payment'::text, 'refund'::text])))")).toBe(
      "check((kind=any(array['payment','refund'])))",
    );
  });
});

describe("amount CHECK allowlist", () => {
  it("accepts complete amount > 0 renderings", () => {
    expect(isAcceptedPaymentsAmountCheck("CHECK ((amount > (0)::numeric))")).toBe(true);
    expect(isAcceptedPaymentsAmountCheck("CHECK ((amount > 0))")).toBe(true);
    expect(isAcceptedPaymentsAmountCheck("CHECK (amount > 0)")).toBe(true);
  });

  it("rejects weaker amount rules", () => {
    expect(isAcceptedPaymentsAmountCheck("CHECK ((amount >= 0))")).toBe(false);
    expect(isAcceptedPaymentsAmountCheck("CHECK ((amount > -1))")).toBe(false);
    expect(isAcceptedPaymentsAmountCheck("CHECK ((amount IS NOT NULL))")).toBe(false);
  });
});

describe("kind CHECK allowlist", () => {
  it("accepts complete payment|refund set in either order / form", () => {
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = ANY (ARRAY['payment'::text, 'refund'::text])))")).toBe(true);
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = ANY (ARRAY['refund'::text, 'payment'::text])))")).toBe(true);
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = ANY ('{payment,refund}'::text[])))")).toBe(true);
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind IN ('payment'::text, 'refund'::text)))")).toBe(true);
  });

  it("rejects incomplete, weaker, or self-referential kind rules", () => {
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = ANY (ARRAY['payment'::text])))")).toBe(false);
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = ANY (ARRAY['payment'::text, 'refund'::text, 'adjust'::text])))")).toBe(
      false,
    );
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = 'payment'::text OR true))")).toBe(false);
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind IS NOT NULL))")).toBe(false);
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = ANY (ARRAY['payment'::text, 'refund'::text, kind])))")).toBe(
      false,
    );
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind IN ('payment'::text, 'refund'::text, kind)))")).toBe(false);
    expect(isAcceptedPaymentsKindCheck("CHECK ((kind = ANY (ARRAY['payment'::text, 'refund'::text] || ARRAY[kind])))")).toBe(
      false,
    );
    expect(isAcceptedPaymentsKindCheck("CHECK (((kind = ANY (ARRAY['payment'::text, 'refund'::text])) OR (1=1)))")).toBe(
      false,
    );
  });

  it("allowlist size matches SQL (2 perms × 3 forms)", () => {
    expect(kindCheckAllowlist().size).toBe(6);
  });
});

describe("payment_method CHECK allowlist", () => {
  it("accepts the complete four-value set", () => {
    expect(
      isAcceptedPaymentsPaymentMethodCheck(
        "CHECK ((payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'bank_transfer'::text, 'other'::text])))",
      ),
    ).toBe(true);
    expect(
      isAcceptedPaymentsPaymentMethodCheck(
        "CHECK ((payment_method = ANY (ARRAY['other'::text, 'bank_transfer'::text, 'card'::text, 'cash'::text])))",
      ),
    ).toBe(true);
  });

  it("rejects missing values, weakenings, or self-references", () => {
    expect(
      isAcceptedPaymentsPaymentMethodCheck(
        "CHECK ((payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'other'::text])))",
      ),
    ).toBe(false);
    expect(isAcceptedPaymentsPaymentMethodCheck("CHECK ((payment_method IS NOT NULL OR true))")).toBe(false);
    expect(
      isAcceptedPaymentsPaymentMethodCheck(
        "CHECK ((payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'bank_transfer'::text, 'other'::text, payment_method])))",
      ),
    ).toBe(false);
  });

  it("allowlist size matches SQL (24 perms × 3 forms)", () => {
    expect(paymentMethodCheckAllowlist().size).toBe(72);
  });
});

describe("currency_code format CHECK allowlist", () => {
  it("accepts the exact three-letter uppercase regex", () => {
    expect(isAcceptedPaymentsCurrencyCodeFormatCheck("CHECK ((currency_code ~ '^[A-Z]{3}$'::text))")).toBe(true);
    expect(isAcceptedPaymentsCurrencyCodeFormatCheck("CHECK ((currency_code ~ '^[A-Z]{3}$'))")).toBe(true);
  });

  it("rejects case-insensitive or shorter patterns", () => {
    expect(isAcceptedPaymentsCurrencyCodeFormatCheck("CHECK ((currency_code ~ '^[a-z]{3}$'))")).toBe(false);
    expect(isAcceptedPaymentsCurrencyCodeFormatCheck("CHECK ((currency_code ~ '^[A-Z]{2,3}$'))")).toBe(false);
    expect(isAcceptedPaymentsCurrencyCodeFormatCheck("CHECK ((currency_code IS NOT NULL))")).toBe(false);
  });
});
