import type { Order, OrderKind } from "../../lib/types";
import { isOrderEstimatesSupported } from "../../services/apiOrders";

export function orderKindOf(order: Pick<Order, "kind"> | null | undefined): OrderKind {
  return order?.kind === "estimate" ? "estimate" : "order";
}

export function isEstimateOrder(order: Pick<Order, "kind"> | null | undefined): boolean {
  return orderKindOf(order) === "estimate";
}

/** Whether the estimates UI (switch, create estimate, card mode) may be shown. */
export function canUseOrderEstimates(supported = isOrderEstimatesSupported()): boolean {
  return supported;
}

/** Card sections that stay hidden while the row is still an estimate. */
export function estimateCardVisibility(order: Pick<Order, "kind"> | null | undefined) {
  const estimate = isEstimateOrder(order);
  return {
    isEstimate: estimate,
    showPayments: !estimate,
    showCloseCancel: !estimate,
    showWarranty: !estimate,
    showPublicLink: !estimate,
    showInvoice: !estimate,
    showConvertButton: estimate,
    showEstimateBadge: estimate,
  };
}
