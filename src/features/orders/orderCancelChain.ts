import type { Invoice, Order } from "../../lib/types";

export type OrderCancelChainInvoiceWork = {
  invoice: Invoice;
  /** When true, skip annul and go straight to delete. */
  alreadyErroneous: boolean;
};

/** Invoices linked to the order, oldest-first for stable «1 of N» numbering. */
export function invoicesForOrder(invoices: readonly Invoice[], orderId: string): Invoice[] {
  return invoices
    .filter((invoice) => invoice.orderId === orderId)
    .slice()
    .sort((a, b) => {
      const byCreated = String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
      if (byCreated !== 0) return byCreated;
      return String(a.invoiceNumber ?? "").localeCompare(String(b.invoiceNumber ?? ""));
    });
}

/** Work queue after cancel: non-erroneous first (annul+delete), then already-erroneous (delete only). */
export function buildInvoiceWorkQueue(invoices: readonly Invoice[]): OrderCancelChainInvoiceWork[] {
  const nonErroneous = invoices.filter((invoice) => invoice.status !== "erroneous");
  const erroneous = invoices.filter((invoice) => invoice.status === "erroneous");
  return [
    ...nonErroneous.map((invoice) => ({ invoice, alreadyErroneous: false as const })),
    ...erroneous.map((invoice) => ({ invoice, alreadyErroneous: true as const })),
  ];
}

export type OrderCancelChainCapabilities = {
  /** Subscription write allows mark+delete erroneous invoices (same gate as invoice dialogs). */
  canManageInvoices: boolean;
  /**
   * Null when delete-order may be offered.
   * Set when permission, subscription, remaining invoices, active payments, or cancel state blocks it.
   */
  deleteOrderBlockedReason: string | null;
};

export type OrderCancelChainAdvance =
  | { kind: "annul"; invoice: Invoice; index: number; total: number }
  | { kind: "deleteInvoice"; invoice: Invoice; index: number; total: number }
  | { kind: "deleteOrder" }
  | { kind: "blocked"; reason: string }
  | { kind: "done" };

/**
 * Decide the next step after cancel or after finishing one invoice action.
 * `nextIndex` is the 0-based index of the next invoice in `queue` to process.
 * When `preferDeleteForCurrent` is true, the invoice at `nextIndex` was just annulled.
 */
export function nextCancelChainStep(opts: {
  queue: readonly OrderCancelChainInvoiceWork[];
  nextIndex: number;
  preferDeleteForCurrent?: boolean;
  capabilities: OrderCancelChainCapabilities;
  /** Localized explanation when invoices remain but the user cannot manage them. */
  noInvoicePermissionReason: string;
}): OrderCancelChainAdvance {
  const { queue, nextIndex, preferDeleteForCurrent, capabilities } = opts;

  if (nextIndex < queue.length) {
    if (!capabilities.canManageInvoices) {
      return { kind: "blocked", reason: opts.noInvoicePermissionReason };
    }
    const item = queue[nextIndex]!;
    const index = nextIndex + 1;
    const total = queue.length;
    if (preferDeleteForCurrent || item.alreadyErroneous) {
      return { kind: "deleteInvoice", invoice: item.invoice, index, total };
    }
    return { kind: "annul", invoice: item.invoice, index, total };
  }

  if (capabilities.deleteOrderBlockedReason) {
    return { kind: "blocked", reason: capabilities.deleteOrderBlockedReason };
  }
  return { kind: "deleteOrder" };
}

/** Patch a cancelled order snapshot from cancel RPC fields. */
export function applyCancelResultToOrder(
  order: Order,
  result: {
    customStatusId: string | null;
    customStatus: Order["customStatus"];
    closed_at?: string | null;
  },
): Order {
  return {
    ...order,
    status: "cancelled",
    customStatusId: result.customStatusId,
    customStatus: result.customStatus,
    closedAt: result.closed_at ?? order.closedAt,
  };
}

/** Remaining invoice numbers for stop-toast copy. */
export function remainingInvoiceNumbers(invoices: readonly Invoice[]): string[] {
  return invoices.map((invoice) => invoice.invoiceNumber).filter(Boolean);
}
