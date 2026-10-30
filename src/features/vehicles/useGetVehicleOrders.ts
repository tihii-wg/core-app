import { useQuery } from "@tanstack/react-query";
import { getVehicleOrders } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function vehicleOrdersQueryKey(workspaceId: string | undefined, vehicleId: string) {
  return ["orders", workspaceId, "vehicle", vehicleId] as const;
}

export function useGetVehicleOrders(vehicleId: string | null | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = vehicleId?.trim() ?? "";

  const query = useQuery({
    queryKey: vehicleOrdersQueryKey(workspaceId, id),
    queryFn: () => getVehicleOrders(workspaceId, id),
    enabled: Boolean(workspaceId && id),
  });

  return {
    orders: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
