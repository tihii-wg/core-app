/**
 * Ledger payment types for `public.payments`.
 * DB `payment_method` uses `bank_transfer` (underscore) — distinct from expenses'
 * `bank-transfer` (hyphen) in `PaymentMethod`.
 */

export const ledgerPaymentMethods = ["cash", "card", "bank_transfer", "other"] as const;
export type LedgerPaymentMethod = (typeof ledgerPaymentMethods)[number];

export const paymentKinds = ["payment", "refund"] as const;
export type PaymentKind = (typeof paymentKinds)[number];

/** One row from `public.payments`. */
export type LedgerPayment = {
  id: string;
  workspaceId: string;
  orderId: string | null;
  invoiceId: string | null;
  relatedPaymentId: string | null;
  kind: PaymentKind;
  amount: number;
  currencyCode: string;
  paymentMethod: LedgerPaymentMethod;
  paidAt: string;
  note: string;
  createdBy: string | null;
  createdAt: string;
};

export type RecordPaymentInput = {
  orderId?: string | null;
  invoiceId?: string | null;
  amount: number;
  currencyCode: string;
  paymentMethod: LedgerPaymentMethod;
  paidAt: string;
  note?: string;
};

export type RecordRefundInput = {
  originalPaymentId: string;
  amount: number;
  currencyCode: string;
  paymentMethod: LedgerPaymentMethod;
  paidAt: string;
  note?: string;
};

export type PaymentListFilters = {
  orderId?: string;
  invoiceId?: string;
  /** Inclusive YYYY-MM-DD on paid_at (date portion). */
  paidFrom?: string;
  paidTo?: string;
  paymentMethod?: LedgerPaymentMethod;
  /** `invoice` = has invoice_id; `no-invoice` = payment without invoice_id. */
  link?: "invoice" | "no-invoice";
};

/** Derived settlement for an order or invoice against ledger rows. */
export type PaymentBalance = {
  total: number;
  netPaid: number;
  remaining: number;
  /** Positive when netPaid exceeds total. */
  overpayment: number;
  status: "unpaid" | "partial" | "paid";
  /** True when at least one valid ledger row is linked. */
  hasLedger: boolean;
  /** True when status/is_paid/paid flag suggests paid but no ledger rows exist. */
  isLegacyUnreconciled: boolean;
};

export type LegacyUnreconciled = {
  kind: "order" | "invoice";
  id: string;
  label: string;
  amount: number;
  /** Invoice paid_at when available; orders have no payment date. */
  attributedDate: string | null;
  dateReliable: boolean;
};
