import { useQuery } from "@tanstack/react-query";
import { getClientOrders, isOrderEstimatesSupported } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { canUseOrderEstimates } from "../orders/orderEstimates";

/** Estimates (orders.kind=estimate) for one client — empty when the SQL is not applied. */
export function useClientEstimates(clientId: string | null | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = clientId?.trim() ?? "";
  const supported = canUseOrderEstimates(isOrderEstimatesSupported());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", workspaceId, "client-estimates", id],
    queryFn: () => getClientOrders(workspaceId, id, "estimate"),
    enabled: Boolean(workspaceId) && Boolean(id) && supported && enabled,
  });

  return {
    estimates: data ?? [],
    isLoading: supported ? isLoading : false,
    error,
    refetch,
    supported,
  };
}
