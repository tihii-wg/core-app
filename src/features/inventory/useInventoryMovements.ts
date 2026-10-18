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
