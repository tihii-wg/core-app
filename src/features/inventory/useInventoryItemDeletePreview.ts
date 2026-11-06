import { useQuery } from "@tanstack/react-query";
import { getInventoryItemDeletePreview } from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function inventoryItemDeletePreviewQueryKey(workspaceId: string | undefined, itemId: string | null | undefined) {
  return ["inventory-delete-preview", workspaceId, itemId] as const;
}

export function useInventoryItemDeletePreview(itemId: string | null | undefined, enabled: boolean) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = itemId?.trim() || "";

  return useQuery({
    queryKey: inventoryItemDeletePreviewQueryKey(workspaceId, id || null),
    queryFn: () => getInventoryItemDeletePreview(id, workspaceId),
    enabled: enabled && Boolean(workspaceId) && Boolean(id),
    staleTime: 0,
    retry: false,
  });
}
