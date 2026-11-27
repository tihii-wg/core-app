import { useQuery } from "@tanstack/react-query";
import { getInvoice, getInvoiceNumbersForOrders, getInvoices, InvoicesUnavailableError } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetInvoices({ enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: invoices, isLoading, error, refetch } = useQuery({
    queryKey: ["invoices", workspaceId],
    queryFn: () => getInvoices(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: (failureCount, queryError) => !(queryError instanceof InvoicesUnavailableError) && failureCount < 3,
  });

  return { invoices: invoices ?? [], isLoading, error, refetch, isUnavailable: error instanceof InvoicesUnavailableError };
}

/** Kept under ["invoices", workspaceId] so invoice mutations refresh the open invoice too. */
export function useGetInvoice(invoiceId: string | null) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ["invoices", workspaceId, invoiceId],
    queryFn: () => getInvoice(invoiceId!, workspaceId),
    enabled: Boolean(workspaceId && invoiceId),
  });

  return { invoice, isLoading, error };
}

const NO_NUMBERS = new Map<string, string>();

/**
 * Invoice numbers of the given orders only (orders list / open order). Kept under
 * ["invoices", workspaceId] so creating or deleting an invoice refreshes it too.
 */
export function useInvoiceNumbersByOrder(orderIds: readonly string[], { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const ids = [...new Set(orderIds.filter(Boolean))].sort();
  const { data, error } = useQuery({
    queryKey: ["invoices", workspaceId, "numbers-by-order", ids],
    queryFn: () => getInvoiceNumbersForOrders(workspaceId, ids),
    enabled: Boolean(workspaceId) && enabled && ids.length > 0,
    // Keep the previous page's numbers while the next page's load (no flicker of the column).
    placeholderData: (previous) => previous,
    retry: (failureCount, queryError) => !(queryError instanceof InvoicesUnavailableError) && failureCount < 3,
  });
  return { invoiceNumberByOrder: data ?? NO_NUMBERS, isUnavailable: error instanceof InvoicesUnavailableError };
}
