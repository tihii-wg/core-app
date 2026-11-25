import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { setOrderItemVisibility } from "../../services/apiOrderComments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { orderAttachmentsQueryKey } from "./orderAttachments";

/** Switch a comment / file between private and public; refreshes that order's list once. */
export function useSetOrderItemVisibility(orderId: string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: ({ kind, id, isPublic }: { kind: "comment" | "file"; id: string; isPublic: boolean }) => {
      guardWrite();
      return setOrderItemVisibility(kind, id, isPublic);
    },
    onSuccess: (_result, { kind }) => {
      void queryClient.invalidateQueries({
        queryKey: kind === "comment" ? ["order_comments", workspaceId, orderId] : orderAttachmentsQueryKey(workspaceId, orderId),
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

