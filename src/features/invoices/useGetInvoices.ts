import { useQuery } from "@tanstack/react-query";
import { getInvoices, InvoicesUnavailableError } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetInvoices({ enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: invoices, isLoading, error } = useQuery({
    queryKey: ["invoices", workspaceId],
    queryFn: () => getInvoices(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: (failureCount, queryError) => !(queryError instanceof InvoicesUnavailableError) && failureCount < 3,
  });

  return { invoices: invoices ?? [], isLoading, error, isUnavailable: error instanceof InvoicesUnavailableError };
}
