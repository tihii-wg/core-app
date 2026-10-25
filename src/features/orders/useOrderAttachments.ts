import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createOrderAttachmentSignedUrl,
  deleteOrderAttachment,
  listOrderAttachments,
  uploadOrderAttachment,
} from "../../services/apiOrderAttachments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { canMutateOrderAttachments, orderAttachmentsQueryKey } from "./orderAttachments";

/** Upload/delete require a known workspace role AND subscription write entitlement. */
export function useCanMutateOrderAttachments() {
  const role = useActiveWorkspaceRole();
  const { canWrite } = useWorkspaceSubscription();
  return canMutateOrderAttachments(role, { hasActiveSubscription: canWrite });
}

export function useOrderAttachments(orderId: string | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();

  const query = useQuery({
    queryKey: orderAttachmentsQueryKey(workspaceId, orderId),
    queryFn: () => listOrderAttachments(workspaceId, orderId),
    enabled: Boolean(workspaceId && orderId) && enabled,
    staleTime: 30_000,
  });

  return {
    attachments: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useUploadOrderAttachment(orderId: string | undefined) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const canMutate = useCanMutateOrderAttachments();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!canMutate) throw new Error(i18n.t("settings.subscription.errors.writeDenied"));
      return uploadOrderAttachment(workspaceId, orderId, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderAttachmentsQueryKey(workspaceId, orderId) });
      toast.success(i18n.t("orders.attachments.toast.uploaded"), { id: "order-attachment-uploaded" });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : i18n.t("orders.attachments.errors.uploadFailed"), {
        id: "order-attachment-upload-failed",
      });
    },
  });
}

export function useDeleteOrderAttachment(orderId: string | undefined) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const canMutate = useCanMutateOrderAttachments();

  return useMutation({
    mutationFn: async (attachmentId: string) => {
      if (!canMutate) throw new Error(i18n.t("settings.subscription.errors.writeDenied"));
      return deleteOrderAttachment(workspaceId, orderId, attachmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderAttachmentsQueryKey(workspaceId, orderId) });
      toast.success(i18n.t("orders.attachments.toast.deleted"), { id: "order-attachment-deleted" });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : i18n.t("orders.attachments.errors.deleteFailed"), {
        id: "order-attachment-delete-failed",
      });
    },
  });
}

export function useOrderAttachmentSignedUrl(storagePath: string | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["order-attachment-signed-url", storagePath],
    queryFn: () => createOrderAttachmentSignedUrl(storagePath ?? ""),
    enabled: Boolean(storagePath) && enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
