import { useQuery } from "@tanstack/react-query";
import { getInventoryMovements } from "../../services/apiWarehouse";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useInventoryMovements(inventoryItemId: string | undefined, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();

  return useQuery({
    queryKey: ["inventory-movements", workspaceId, inventoryItemId],
    queryFn: () => getInventoryMovements(workspaceId, { inventoryItemId, limit: 25 }),
    enabled: Boolean(workspaceId && inventoryItemId && enabled),
  });
}

/** Recent movements across the workspace (not scoped to one item). */
export function useWorkspaceInventoryMovements(limit = 50, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();

  return useQuery({
    queryKey: ["inventory-movements", workspaceId, "workspace", limit],
    queryFn: () => getInventoryMovements(workspaceId, { limit }),
    enabled: Boolean(workspaceId && enabled),
  });
}
