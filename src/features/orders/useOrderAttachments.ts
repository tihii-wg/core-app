import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  deleteOrderAttachment,
  listOrderAttachments,
  resolveOrderAttachmentUrl,
  uploadOrderAttachment,
} from "../../services/apiOrderAttachments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { canMutateOrderAttachments, isRemoteAttachment, orderAttachmentsQueryKey, type OrderAttachment } from "./orderAttachments";

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
    isFetched: query.isFetched,
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
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: orderAttachmentsQueryKey(workspaceId, orderId) });
      if (result.fallbackFrom === "nas") {
        toast(i18n.t("orders.attachments.toast.nasFallback"), {
          id: "order-attachment-nas-fallback",
          duration: 6000,
        });
      } else if (result.fallbackFrom === "google_drive") {
        toast(i18n.t("orders.attachments.toast.driveFallback"), {
          id: "order-attachment-drive-fallback",
          duration: 6000,
        });
      } else {
        toast.success(i18n.t("orders.attachments.toast.uploaded"), { id: "order-attachment-uploaded" });
      }
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

/**
 * Loads a display URL for an attachment. App rows use signed Storage URLs;
 * Drive rows fetch via the content Edge Function into a blob URL (revoked on unmount/change).
 */
export function useOrderAttachmentUrl(
  attachment: Pick<OrderAttachment, "id" | "storagePath" | "storageProvider" | "driveFileId" | "nasPath"> | null | undefined,
  { enabled = true, variant = "full" }: { enabled?: boolean; variant?: "thumb" | "full" } = {},
) {
  const remote = attachment ? isRemoteAttachment(attachment) : false;
  const query = useQuery({
    queryKey: ["order-attachment-url", attachment?.id, attachment?.storagePath, variant, remote],
    queryFn: () => resolveOrderAttachmentUrl(attachment!, variant),
    enabled: Boolean(attachment) && enabled,
    staleTime: remote ? 4 * 60 * 1000 : 10 * 60 * 1000,
    retry: false,
  });

  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!remote) {
      setBlobUrl(null);
      return;
    }
    const url = query.data ?? null;
    setBlobUrl(url);
    return () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [remote, query.data]);

  return {
    data: remote ? blobUrl : query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** @deprecated Prefer useOrderAttachmentUrl with the full attachment. */
export function useOrderAttachmentSignedUrl(storagePath: string | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["order-attachment-signed-url", storagePath],
    queryFn: async () => {
      const { createOrderAttachmentSignedUrl } = await import("../../services/apiOrderAttachments");
      return createOrderAttachmentSignedUrl(storagePath ?? "");
    },
    enabled: Boolean(storagePath) && enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
