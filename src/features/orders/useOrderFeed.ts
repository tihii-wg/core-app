import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createOrderComment, deleteOrderComment, getOrderComments } from "../../services/apiOrderComments";
import { getOrderEvents } from "../../services/apiOrderEvents";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useGetOrderEvents(orderId: string | null | undefined, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = orderId?.trim() ?? "";
  const query = useQuery({
    queryKey: ["order_events", workspaceId, id],
    queryFn: () => getOrderEvents(workspaceId, id),
    enabled: enabled && Boolean(workspaceId && id),
  });
  return {
    events: query.data?.events ?? [],
    isUnavailable: query.data?.isUnavailable ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function useGetOrderComments(orderId: string | null | undefined, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = orderId?.trim() ?? "";
  const query = useQuery({
    queryKey: ["order_comments", workspaceId, id],
    queryFn: () => getOrderComments(workspaceId, id),
    enabled: enabled && Boolean(workspaceId && id),
  });
  return {
    comments: query.data?.comments ?? [],
    isUnavailable: query.data?.isUnavailable ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function useCreateOrderComment(orderId: string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (body: string) => {
      guardWrite();
      return createOrderComment(workspaceId, orderId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order_comments", workspaceId, orderId] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("orders.feed.errors.writeFailed"), { id: "order-comment-write" });
    },
  });
}

export function useDeleteOrderComment(orderId: string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (commentId: string) => {
      guardWrite();
      return deleteOrderComment(workspaceId, orderId, commentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order_comments", workspaceId, orderId] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("orders.feed.errors.writeFailed"), { id: "order-comment-write" });
    },
  });
}
