import type { Order } from "../../lib/types";
import type { StatusDefinition, StatusSemanticAction } from "../../services/apiStatusDefinitions";
import type { WarrantyStart } from "../../lib/workspaceGeneralSettings";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import type { LedgerPayment } from "../finance/paymentTypes";

/** Parse close/cancel RPC error messages into structured fields. */
export function parseLifecycleRpcError(message: string): {
  code: string;
  remaining?: number;
  currency?: string;
} {
  const remainingMatch = message.match(/remaining=([0-9]+(?:\.[0-9]+)?)/i);
  const currencyMatch = message.match(/currency=([A-Za-z]{0,8})/i);
  const codeMatch = message.match(/order_lifecycle:([a-z0-9_]+)/i);
  return {
    code: codeMatch?.[1] ?? "unknown",
    remaining: remainingMatch ? Number(remainingMatch[1]) : undefined,
    currency: currencyMatch?.[1] || undefined,
  };
}

export function isNormalWorkflowStatus(definition: Pick<StatusDefinition, "semanticAction" | "isActive">) {
  return definition.isActive && definition.semanticAction === "normal";
}

export function findSemanticStatus(
  definitions: readonly StatusDefinition[],
  action: Extract<StatusSemanticAction, "close" | "cancel">,
) {
  return definitions.find((d) => d.entity === "order" && d.isActive && d.semanticAction === action) ?? null;
}

export function findDefaultOrderStatus(definitions: readonly StatusDefinition[]) {
  const active = definitions.filter((d) => d.entity === "order" && d.isActive && d.semanticAction === "normal");
  return active.find((d) => d.isDefault) ?? active[0] ?? null;
}

/**
 * Warranty start instant for an order given workspace.warranty_start.
 * Cancellation never activates warranty (no closed_at).
 */
export function resolveWarrantyStartAt(
  order: Pick<Order, "createdAt" | "closedAt" | "status">,
  warrantyStart: WarrantyStart,
): string | null {
  if (order.status === "cancelled") return null;
  if (warrantyStart === "closed_at") {
    return order.closedAt?.trim() || null;
  }
  return order.createdAt?.trim() || null;
}

/**
 * Whether the order is formally closed right now (active `closed_at` and/or
 * status=closed). Cancel preserves `closed_at`; owner reopen clears it so this
 * becomes false and the normal Close Order workflow returns.
 */
export function isOrderFormallyClosed(order: Pick<Order, "closedAt" | "status">) {
  return Boolean(order.closedAt?.trim()) || order.status === "closed";
}

/**
 * Whether the order is in the live closed lifecycle state right now.
 * Use for the detail-card closure banner — cancelled or reopened orders must
 * not show the closed-state message even if history still has past closures.
 */
export function isOrderCurrentlyClosed(order: Pick<Order, "status" | "closedAt">) {
  return order.status === "closed" && Boolean(order.closedAt?.trim());
}

/**
 * Outstanding after closure (refunds allowed). Display-only; does not reopen.
 * Uses the same ledger formula as close eligibility.
 */
export function closedOrderOutstanding(
  order: Pick<Order, "id" | "totalPrice" | "isPaid" | "status">,
  payments: LedgerPayment[],
  invoiceIdForOrder?: string | null,
) {
  return orderPaymentBalance(order, payments, invoiceIdForOrder);
}
