import { useQuery } from "@tanstack/react-query";
import { getWorkspaceVatRate } from "../../services/apiWorkspaceVat";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/**
 * Current workspace VAT rate (percent) for new orders / display fallback.
 * Prefers `crm_workspace_vat_rate`; falls back to the highest active included tax.
 */
export function useWorkspaceVatRate() {
  const { workspaceId } = useActiveWorkspaceId();
  const query = useQuery({
    queryKey: ["workspace-vat-rate", workspaceId],
    queryFn: () => getWorkspaceVatRate(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    retry: false,
  });

  return {
    rate: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
