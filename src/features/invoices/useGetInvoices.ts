import { useQuery } from "@tanstack/react-query";
import { getInvoice, getInvoices, InvoicesUnavailableError } from "../../services/apiInvoices";
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
