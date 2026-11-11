import { useQuery } from "@tanstack/react-query";
import { countClientOrders } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/** React Query key for client order totals (invalidated with `["orders", workspaceId]`). */
export function clientOrdersCountQueryKey(workspaceId: string | undefined, clientId: string) {
  return ["orders", workspaceId, "client-count", clientId] as const;
}

/**
 * Exact total of orders for a client in the active workspace.
 * Independent of list search, status filters, and pagination.
 */
export function useClientOrdersCount(
  clientId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = clientId?.trim() ?? "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: clientOrdersCountQueryKey(workspaceId, id),
    queryFn: () => countClientOrders(workspaceId, id),
    enabled: Boolean(workspaceId) && Boolean(id) && enabled,
  });

  return {
    count: typeof data === "number" ? data : null,
    isLoading,
    error,
    refetch,
  };
}
