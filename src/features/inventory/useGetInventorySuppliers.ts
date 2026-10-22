import { useQuery } from "@tanstack/react-query";
import { getInventorySuppliers } from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/** Supplier names present on parts in the active workspace (filter options). */
export function useGetInventorySuppliers() {
  const { workspaceId } = useActiveWorkspaceId();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["inventory", workspaceId, "suppliers"],
    queryFn: () => getInventorySuppliers(workspaceId),
    enabled: Boolean(workspaceId),
  });

  return {
    suppliers: data ?? [],
    isLoading,
    isError,
  };
}
