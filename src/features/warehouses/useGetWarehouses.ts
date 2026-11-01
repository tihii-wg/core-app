import { useQuery } from "@tanstack/react-query";
import { getBinLocations, getWarehouses } from "../../services/apiWarehouses";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetWarehouses() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["warehouses", workspaceId],
    queryFn: () => getWarehouses(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useGetBinLocations() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["bin-locations", workspaceId],
    queryFn: () => getBinLocations(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
