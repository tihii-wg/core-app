import { useQuery } from "@tanstack/react-query";
import { getWarehouseStock } from "../../services/apiWarehouseStock";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetWarehouseStock() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["warehouse-stock", workspaceId],
    queryFn: () => getWarehouseStock(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
