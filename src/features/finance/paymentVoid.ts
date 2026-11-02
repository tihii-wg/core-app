/**
 * Erroneous-payment void / cancellation support.
 *
 * Schema (after applying 20261102140000_payment_void_erroneous_cleanup.PRODUCTION.sql):
 * - Append-only for anon/authenticated except cleanup RPC for fully voided rows
 * - kind ∈ {payment, refund, void}
 * - Void = money never received (distinct from refund)
 * - Optional delete_fully_voided_payment removes payment+void only (invoice/order untouched)
 *
 * App UI is enabled; if SQL is not applied yet, inserts/RPCs fail with a clear schema message.
 */

import { isFullyVoidedPayment, refundableRemaining } from "./paymentCalculations";
import type { LedgerPayment } from "./paymentTypes";

/** App supports void once SQL is applied; API maps missing constraint/RPC to schema errors. */
export const PAYMENT_VOID_SCHEMA_SUPPORTED = true;

export type PaymentVoidBlockReason =
  | "schema_unsupported"
  | "not_a_payment"
  | "already_offset"
  | "no_permission";

export type PaymentVoidAssessment =
  | { allowed: true }
  | { allowed: false; reason: PaymentVoidBlockReason };

/**
 * Business rules for voiding an erroneous payment (money never received).
 * Distinct from refund (money was received and returned).
 */
export function assessErroneousPaymentVoid(
  payment: LedgerPayment,
  allPayments: LedgerPayment[],
  options: { canRecord: boolean } = { canRecord: true },
): PaymentVoidAssessment {
  if (!options.canRecord) return { allowed: false, reason: "no_permission" };
  if (payment.kind !== "payment") return { allowed: false, reason: "not_a_payment" };

  // Any prior refund/offset means this is no longer a clean "never received" entry —
  // remaining money movement must use the refund workflow.
  const refundable = refundableRemaining(payment, allPayments);
  if (refundable < payment.amount - 1e-9) {
    return { allowed: false, reason: "already_offset" };
  }

  if (!PAYMENT_VOID_SCHEMA_SUPPORTED) {
    return { allowed: false, reason: "schema_unsupported" };
  }

  return { allowed: true };
}

export type PaymentCleanupAssessment =
  | { allowed: true }
  | { allowed: false; reason: "not_a_payment" | "not_fully_voided" | "no_permission" };

/** Cleanup delete is only for payments already fully marked erroneous via void (no refunds). */
export function assessDeleteFullyVoidedPayment(
  payment: LedgerPayment,
  allPayments: LedgerPayment[],
  options: { canRecord: boolean } = { canRecord: true },
): PaymentCleanupAssessment {
  if (!options.canRecord) return { allowed: false, reason: "no_permission" };
  if (payment.kind !== "payment") return { allowed: false, reason: "not_a_payment" };
  if (!isFullyVoidedPayment(payment, allPayments)) {
    return { allowed: false, reason: "not_fully_voided" };
  }
  return { allowed: true };
}

/** Minimum reason length once void inserts are schema-supported. */
export const PAYMENT_VOID_REASON_MIN_LENGTH = 8;

export function validatePaymentVoidReason(reason: string): "required" | "too_short" | null {
  const trimmed = reason.trim();
  if (!trimmed) return "required";
  if (trimmed.length < PAYMENT_VOID_REASON_MIN_LENGTH) return "too_short";
  return null;
}
