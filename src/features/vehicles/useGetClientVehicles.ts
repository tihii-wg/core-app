import { useQuery } from "@tanstack/react-query";
import { getClientVehicles } from "../../services/apiVehicles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function clientVehiclesQueryKey(workspaceId: string | undefined, clientId: string) {
  return ["vehicles", workspaceId, clientId] as const;
}

export function useGetClientVehicles(clientId: string | null | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = clientId?.trim() ?? "";

  const query = useQuery({
    queryKey: clientVehiclesQueryKey(workspaceId, id),
    queryFn: () => getClientVehicles(workspaceId, id),
    enabled: Boolean(workspaceId && id),
  });

  return {
    vehicles: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
