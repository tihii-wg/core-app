import i18n from "../i18n";
import supabase from "./supabase";
import {
  assertWorkspaceCurrencyMatch,
  isNormalizedCurrencyCode,
  isValidLedgerPayment,
  ledgerAmount,
  ledgerCurrencyGate,
  normalizeCurrencyCode,
  paymentsAffectingInvoice,
  paymentsAffectingOrder,
  refundableRemaining,
  remainingForTotal,
  roundMoney,
  wouldExceedRemaining,
} from "../features/finance/paymentCalculations";
import {
  ledgerPaymentMethods,
  paymentKinds,
  type LedgerPayment,
  type LedgerPaymentMethod,
  type PaymentKind,
  type PaymentListFilters,
  type RecordPaymentInput,
  type RecordRefundInput,
} from "../features/finance/paymentTypes";

const paymentColumns =
  "id, workspace_id, order_id, invoice_id, related_payment_id, kind, amount, currency_code, payment_method, paid_at, note, created_by, created_at";

/** The payments table is missing from the connected database (PostgREST PGRST205 / Postgres 42P01). */
export class PaymentsUnavailableError extends Error {
  constructor() {
    super(i18n.t("finance.payments.errors.unavailable"));
    this.name = "PaymentsUnavailableError";
  }
}

type DbError = { code?: string; message: string; details?: string | null; hint?: string | null };

/** Map known DB / trigger validation messages to localized copy. */
export function mapPaymentDbError(error: DbError): Error {
  if (error.code === "PGRST205" || error.code === "42P01") return new PaymentsUnavailableError();
  if (error.code === "42501") return new Error(i18n.t("finance.payments.errors.noPermission"));
  // Serialization / retryable relationship race from the integrity trigger.
  if (error.code === "40001") return new Error(i18n.t("finance.payments.errors.invoiceOrderChangedRetry"));

  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  const match = blob.match(/payments_validation:([a-z0-9_]+)/i);
  const code = match?.[1]?.toLowerCase() ?? "";

  switch (code) {
    case "amount_positive":
      return new Error(i18n.t("finance.payments.validation.amountPositive"));
    case "link_required":
      return new Error(i18n.t("finance.payments.validation.linkRequired"));
    case "currency_required":
      return new Error(i18n.t("finance.payments.validation.currencyRequired"));
    case "method_invalid":
      return new Error(i18n.t("finance.payments.validation.methodInvalid"));
    case "workspace_mismatch":
      return new Error(i18n.t("finance.payments.errors.workspaceMismatch"));
    case "invoice_order_mismatch":
      return new Error(i18n.t("finance.payments.errors.invoiceOrderMismatch"));
    case "order_not_found":
      return new Error(i18n.t("finance.payments.errors.orderNotFound"));
    case "invoice_not_found":
      return new Error(i18n.t("finance.payments.errors.invoiceNotFound"));
    case "payment_exceeds_remaining":
      return new Error(i18n.t("finance.payments.errors.paymentExceedsRemaining"));
    case "refund_against_refund":
      return new Error(i18n.t("finance.payments.errors.refundAgainstRefund"));
    case "refund_invalid_original":
      return new Error(i18n.t("finance.payments.errors.originalInvalid"));
    case "currency_mismatch":
      return new Error(i18n.t("finance.payments.errors.currencyMismatch"));
    case "currency_mixed":
      return new Error(i18n.t("finance.payments.errors.currencyMixed"));
    case "currency_format":
      return new Error(i18n.t("finance.payments.validation.currencyFormat"));
    case "workspace_currency_invalid":
      return new Error(i18n.t("finance.payments.errors.workspaceCurrencyInvalid"));
    case "invoice_order_changed_retry":
      return new Error(i18n.t("finance.payments.errors.invoiceOrderChangedRetry"));
    case "refund_exceeds_remaining":
      return new Error(i18n.t("finance.payments.errors.refundExceedsRemaining", { remaining: "?" }));
    case "refund_links_mismatch":
      return new Error(i18n.t("finance.payments.errors.refundLinksMismatch"));
    default:
      return new Error(error.message || i18n.t("finance.payments.errors.saveFailed"));
  }
}

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toLedgerPayment(row: Record<string, unknown>): LedgerPayment {
  const kindRaw = text(row.kind) as PaymentKind;
  const kind = paymentKinds.includes(kindRaw) ? kindRaw : "payment";
  const methodRaw = text(row.payment_method) as LedgerPaymentMethod;
  const paymentMethod = ledgerPaymentMethods.includes(methodRaw) ? methodRaw : "other";
  return {
    id: String(row.id),
    workspaceId: text(row.workspace_id),
    orderId: text(row.order_id) || null,
    invoiceId: text(row.invoice_id) || null,
    relatedPaymentId: text(row.related_payment_id) || null,
    kind,
    amount: Number(row.amount ?? 0),
    currencyCode: text(row.currency_code),
    paymentMethod,
    paidAt: text(row.paid_at),
    note: text(row.note),
    createdBy: text(row.created_by) || null,
    createdAt: text(row.created_at),
  };
}

async function requireAuthenticatedUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!user) throw new Error(i18n.t("finance.payments.errors.notAuthenticated"));
  return user;
}

function validatePositiveAmount(amount: unknown) {
  const value = ledgerAmount(amount);
  if (value == null) throw new Error(i18n.t("finance.payments.validation.amountPositive"));
  return roundMoney(value);
}

function validateMethod(method: string): LedgerPaymentMethod {
  if (!ledgerPaymentMethods.includes(method as LedgerPaymentMethod)) {
    throw new Error(i18n.t("finance.payments.validation.methodInvalid"));
  }
  return method as LedgerPaymentMethod;
}

function validatePaidAt(paidAt: string) {
  const raw = paidAt.trim();
  if (!raw) throw new Error(i18n.t("finance.payments.validation.dateRequired"));
  return raw;
}

function validateCurrency(currencyCode: string) {
  const code = normalizeCurrencyCode(currencyCode);
  if (!code) throw new Error(i18n.t("finance.payments.validation.currencyRequired"));
  if (!isNormalizedCurrencyCode(code)) throw new Error(i18n.t("finance.payments.validation.currencyFormat"));
  return code;
}

async function requireWorkspaceCurrency(workspaceId: string, paymentCurrency: string) {
  const { data, error } = await supabase.from("workspaces").select("currency").eq("id", workspaceId).is("deleted_at", null).maybeSingle();
  if (error) throw mapPaymentDbError(error);
  if (!data) throw new Error(i18n.t("finance.payments.errors.workspaceCurrencyInvalid"));
  const workspaceCurrency = typeof data.currency === "string" ? data.currency : "";
  const match = assertWorkspaceCurrencyMatch(workspaceCurrency, paymentCurrency);
  if (match === "workspace_invalid") throw new Error(i18n.t("finance.payments.errors.workspaceCurrencyInvalid"));
  if (match === "mismatch") throw new Error(i18n.t("finance.payments.errors.currencyMismatch"));
}

function assertCurrencyGate(existing: LedgerPayment[], proposedCurrency: string) {
  const gate = ledgerCurrencyGate(existing, proposedCurrency);
  if (gate === "mixed") throw new Error(i18n.t("finance.payments.errors.currencyMixed"));
  if (gate === "mismatch") throw new Error(i18n.t("finance.payments.errors.currencyMismatch"));
}

/** Payments of the workspace, newest paid_at first. Optional filters applied server-side where possible. */
export async function getPayments(workspaceId: string | undefined, filters: PaymentListFilters = {}) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  let query = supabase
    .from("payments")
    .select(paymentColumns)
    .eq("workspace_id", targetWorkspaceId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.orderId) query = query.eq("order_id", filters.orderId);
  if (filters.invoiceId) query = query.eq("invoice_id", filters.invoiceId);
  if (filters.paymentMethod) query = query.eq("payment_method", filters.paymentMethod);
  if (filters.link === "invoice") query = query.not("invoice_id", "is", null);
  if (filters.link === "no-invoice") query = query.is("invoice_id", null);
  if (filters.paidFrom) query = query.gte("paid_at", `${filters.paidFrom}T00:00:00.000Z`);
  if (filters.paidTo) query = query.lte("paid_at", `${filters.paidTo}T23:59:59.999Z`);

  const { data, error } = await query;
  if (error) throw mapPaymentDbError(error);
  return ((data ?? []) as Record<string, unknown>[]).map(toLedgerPayment);
}

export async function getPaymentById(paymentId: string, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("payments")
    .select(paymentColumns)
    .eq("id", paymentId)
    .eq("workspace_id", targetWorkspaceId)
    .maybeSingle();

  if (error) throw mapPaymentDbError(error);
  if (!data) throw new Error(i18n.t("finance.payments.errors.notFound"));
  return toLedgerPayment(data as Record<string, unknown>);
}

type ResolvedLinks = {
  orderId: string | null;
  invoiceId: string | null;
  orderTotal: number | null;
  invoiceTotal: number | null;
};

/**
 * Resolve and verify order/invoice links inside the workspace.
 * When an invoice is linked to an order, `order_id` is filled from the invoice so one
 * ledger row carries both references (never two rows for one transaction).
 * When paying an order that already has an invoice, `invoice_id` is attached the same way.
 */
async function resolvePaymentLinks(
  workspaceId: string,
  orderIdInput: string | null,
  invoiceIdInput: string | null,
): Promise<ResolvedLinks> {
  let orderId = orderIdInput;
  let invoiceId = invoiceIdInput;
  let orderTotal: number | null = null;
  let invoiceTotal: number | null = null;

  if (!orderId && !invoiceId) {
    throw new Error(i18n.t("finance.payments.validation.linkRequired"));
  }

  if (invoiceId) {
    const { data: invoice, error } = await supabase
      .from("invoices")
      .select("id, order_id, total, workspace_id")
      .eq("id", invoiceId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw mapPaymentDbError(error);
    if (!invoice) throw new Error(i18n.t("finance.payments.errors.invoiceNotFound"));

    const invOrderId = typeof (invoice as { order_id?: unknown }).order_id === "string" ? (invoice as { order_id: string }).order_id : null;
    invoiceTotal = Number((invoice as { total?: unknown }).total ?? 0);

    if (orderId && invOrderId && invOrderId !== orderId) {
      throw new Error(i18n.t("finance.payments.errors.invoiceOrderMismatch"));
    }
    if (orderId && !invOrderId) {
      throw new Error(i18n.t("finance.payments.errors.invoiceOrderMismatch"));
    }
    if (!orderId && invOrderId) orderId = invOrderId;
  }

  if (orderId) {
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, total_price")
      .eq("id", orderId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw mapPaymentDbError(error);
    if (!order) throw new Error(i18n.t("finance.payments.errors.orderNotFound"));
    orderTotal = Number((order as { total_price?: unknown }).total_price ?? 0);

    if (!invoiceId) {
      const { data: linkedInvoice, error: invError } = await supabase
        .from("invoices")
        .select("id, total")
        .eq("workspace_id", workspaceId)
        .eq("order_id", orderId)
        .maybeSingle();
      if (invError) throw mapPaymentDbError(invError);
      if (linkedInvoice) {
        invoiceId = String((linkedInvoice as { id: string }).id);
        invoiceTotal = Number((linkedInvoice as { total?: unknown }).total ?? 0);
      }
    }
  }

  return { orderId, invoiceId, orderTotal, invoiceTotal };
}

function assertWithinRemaining(amount: number, remaining: number) {
  if (roundMoney(amount - remaining) > 0.005) {
    throw new Error(
      i18n.t("finance.payments.validation.amountExceedsRemaining", {
        remaining: remaining.toFixed(2),
      }),
    );
  }
}

/**
 * Inserts a payment ledger row. Requires order_id and/or invoice_id.
 * Does not update orders.is_paid or invoices.status (ledger is source of truth for amounts).
 * Client remaining checks are for UX; the database trigger (when applied) is authoritative.
 */
export async function recordPayment(input: RecordPaymentInput, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  await requireAuthenticatedUser();

  const amount = validatePositiveAmount(input.amount);
  const paymentMethod = validateMethod(input.paymentMethod);
  const paidAt = validatePaidAt(input.paidAt);
  const currencyCode = validateCurrency(input.currencyCode);
  const note = (input.note ?? "").trim();

  const links = await resolvePaymentLinks(
    targetWorkspaceId,
    input.orderId?.trim() || null,
    input.invoiceId?.trim() || null,
  );

  await requireWorkspaceCurrency(targetWorkspaceId, currencyCode);

  const existing = await getPayments(targetWorkspaceId, {});

  if (links.invoiceId && links.invoiceTotal != null) {
    const linked = paymentsAffectingInvoice(existing, links.invoiceId, links.orderId);
    assertCurrencyGate(linked, currencyCode);
    const remaining = remainingForTotal(links.invoiceTotal, linked);
    assertWithinRemaining(amount, remaining);
    if (wouldExceedRemaining(links.invoiceTotal, linked, amount)) {
      throw new Error(i18n.t("finance.payments.errors.paymentExceedsRemaining"));
    }
  }

  if (links.orderId && links.orderTotal != null) {
    const linked = paymentsAffectingOrder(existing, links.orderId, links.invoiceId);
    assertCurrencyGate(linked, currencyCode);
    const remaining = remainingForTotal(links.orderTotal, linked);
    // When both invoice and order exist, both remaining checks must pass (1:1 invoice per order).
    assertWithinRemaining(amount, remaining);
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      workspace_id: targetWorkspaceId,
      order_id: links.orderId,
      invoice_id: links.invoiceId,
      related_payment_id: null,
      kind: "payment",
      amount,
      currency_code: currencyCode,
      payment_method: paymentMethod,
      paid_at: paidAt,
      note: note || null,
    })
    .select(paymentColumns)
    .single();

  if (error) throw mapPaymentDbError(error);
  return toLedgerPayment(data as Record<string, unknown>);
}

/**
 * Inserts a refund row linked via related_payment_id.
 * Client pre-checks remaining refundable amount for UX. Concurrent safety requires the
 * manual SQL trigger (FOR UPDATE on the original payment). Until that SQL is applied,
 * two concurrent refunds can still overshoot — the client cannot delete an inserted row.
 */
export async function recordRefund(input: RecordRefundInput, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  await requireAuthenticatedUser();

  const amount = validatePositiveAmount(input.amount);
  const paymentMethod = validateMethod(input.paymentMethod);
  const paidAt = validatePaidAt(input.paidAt);
  const currencyCode = validateCurrency(input.currencyCode);
  const note = (input.note ?? "").trim();

  const original = await getPaymentById(input.originalPaymentId, targetWorkspaceId);
  if (original.kind !== "payment") {
    throw new Error(i18n.t("finance.payments.errors.refundAgainstRefund"));
  }
  if (normalizeCurrencyCode(original.currencyCode) !== currencyCode) {
    throw new Error(i18n.t("finance.payments.errors.currencyMismatch"));
  }
  if (!isValidLedgerPayment(original)) {
    throw new Error(i18n.t("finance.payments.errors.originalInvalid"));
  }

  await requireWorkspaceCurrency(targetWorkspaceId, currencyCode);

  const siblings = await getPayments(targetWorkspaceId, {});
  const remaining = refundableRemaining(original, siblings);
  if (roundMoney(amount - remaining) > 0.005) {
    throw new Error(i18n.t("finance.payments.errors.refundExceedsRemaining", { remaining: remaining.toFixed(2) }));
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      workspace_id: targetWorkspaceId,
      order_id: original.orderId,
      invoice_id: original.invoiceId,
      related_payment_id: original.id,
      kind: "refund",
      amount,
      currency_code: currencyCode,
      payment_method: paymentMethod,
      paid_at: paidAt,
      note: note || null,
    })
    .select(paymentColumns)
    .single();

  if (error) throw mapPaymentDbError(error);
  return toLedgerPayment(data as Record<string, unknown>);
}
