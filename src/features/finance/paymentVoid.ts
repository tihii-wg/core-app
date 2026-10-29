/**
 * Erroneous-payment void / cancellation support.
 *
 * Current `public.payments` (see apiPayments columns + harden_payment_ledger.sql):
 * - Append-only for anon/authenticated (no UPDATE/DELETE)
 * - kind ∈ {payment, refund} only
 * - No voided_at / status / cancelled columns
 * - payments.order_id FK blocks hard-deleting orders that have any ledger row
 *
 * Until a reviewed schema change lands (see supabase/manual-sql/propose_payment_void.sql),
 * the app must not insert a void kind, hard-delete payments, or treat refunds as voids.
 */

import { refundableRemaining } from "./paymentCalculations";
import type { LedgerPayment } from "./paymentTypes";

/** Flip only after the reviewed void kind (or equivalent) is live in the database. */
export const PAYMENT_VOID_SCHEMA_SUPPORTED = false;

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

/** Minimum reason length once void inserts are schema-supported. */
export const PAYMENT_VOID_REASON_MIN_LENGTH = 8;

export function validatePaymentVoidReason(reason: string): "required" | "too_short" | null {
  const trimmed = reason.trim();
  if (!trimmed) return "required";
  if (trimmed.length < PAYMENT_VOID_REASON_MIN_LENGTH) return "too_short";
  return null;
}
