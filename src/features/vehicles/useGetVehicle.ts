import { useQuery } from "@tanstack/react-query";
import { getVehicle } from "../../services/apiVehicles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function vehicleQueryKey(workspaceId: string | undefined, vehicleId: string) {
  return ["vehicles", workspaceId, "id", vehicleId] as const;
}

/** Load a single workspace vehicle by id (read-only; does not mutate the vehicle). */
export function useGetVehicle(vehicleId: string | null | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = vehicleId?.trim() ?? "";

  const query = useQuery({
    queryKey: vehicleQueryKey(workspaceId, id),
    queryFn: () => getVehicle(workspaceId, id),
    enabled: Boolean(workspaceId && id),
  });

  return {
    vehicle: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    /** True when the query finished and the vehicle is missing (deleted / wrong workspace). */
    notFound: Boolean(workspaceId && id && query.isFetched && !query.isError && query.data == null),
    refetch: query.refetch,
  };
}
