import { useQuery } from "@tanstack/react-query";
import { listOrderAttachmentsForOrders } from "../../services/apiOrderAttachments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/** Attachments of a client's orders in one batched query; only runs when `enabled` (Documents tab open). */
export function useClientOrderAttachments(clientId: string | undefined, orderIds: string[], { enabled = true } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const sortedIds = [...orderIds].sort();

  const query = useQuery({
    queryKey: ["order-attachments", workspaceId, "client", clientId, sortedIds.join(",")],
    queryFn: () => listOrderAttachmentsForOrders(workspaceId, sortedIds),
    enabled: Boolean(workspaceId && clientId) && sortedIds.length > 0 && enabled,
    staleTime: 30_000,
  });

  return {
    attachments: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
