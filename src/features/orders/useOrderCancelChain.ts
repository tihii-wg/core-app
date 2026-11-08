import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getInvoices, markInvoiceSentInError, deleteErroneousInvoice } from "../../services/apiInvoices";
import { getOrder } from "../../services/apiOrders";
import type { Invoice, Order } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { invalidatePaymentViews } from "../finance/usePayments";
import {
  buildInvoiceWorkQueue,
  invoicesForOrder,
  type OrderCancelChainInvoiceWork,
} from "./orderCancelChain";

/** Shared invalidations after each successful cancel-chain step. */
export function invalidateAfterCancelChainStep(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  orderId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["orders-page", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["orders-warranty-indicators", workspaceId] });
  invalidatePaymentViews(queryClient, workspaceId);
}

export type RefetchedCancelChainContext = {
  order: Order;
  invoices: Invoice[];
  queue: OrderCancelChainInvoiceWork[];
};

export function useOrderCancelChainActions() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  const refetchContext = useCallback(
    async (orderId: string): Promise<RefetchedCancelChainContext> => {
      const [order, invoices] = await Promise.all([
        getOrder(orderId, workspaceId),
        getInvoices(workspaceId),
      ]);
      const linked = invoicesForOrder(invoices, orderId);
      return { order, invoices: linked, queue: buildInvoiceWorkQueue(linked) };
    },
    [workspaceId],
  );

  const annulInvoice = useCallback(
    async (invoiceId: string) => {
      const updated = await markInvoiceSentInError(invoiceId, workspaceId);
      if (updated.orderId) {
        invalidateAfterCancelChainStep(queryClient, workspaceId, updated.orderId);
      } else {
        void queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
        invalidatePaymentViews(queryClient, workspaceId);
      }
      return updated;
    },
    [queryClient, workspaceId],
  );

  const deleteInvoice = useCallback(
    async (invoiceId: string) => {
      const result = await deleteErroneousInvoice(invoiceId, workspaceId);
      if (result.orderId) {
        invalidateAfterCancelChainStep(queryClient, workspaceId, result.orderId);
      } else {
        void queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
        invalidatePaymentViews(queryClient, workspaceId);
      }
      return result;
    },
    [queryClient, workspaceId],
  );

  return { refetchContext, annulInvoice, deleteInvoice, workspaceId, queryClient };
}
