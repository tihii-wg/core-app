import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  disconnectNasStorage,
  disconnectPhotosGoogleDrive,
  getWorkspaceAttachmentUsage,
  getWorkspaceGoogleDrive,
  getWorkspaceNasStorage,
  saveNasConnection,
  setAttachmentStorage,
  startPhotosGoogleDriveOAuth,
  testNasConnection,
  type AttachmentStorageMode,
  type NasConnectionPayload,
} from "../../../services/apiAttachmentStorage";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";

export function workspaceGoogleDriveQueryKey(workspaceId: string | undefined) {
  return ["workspace-google-drive", workspaceId] as const;
}

export function workspaceNasStorageQueryKey(workspaceId: string | undefined) {
  return ["workspace-nas-storage", workspaceId] as const;
}

export function attachmentUsageQueryKey(workspaceId: string | undefined) {
  return ["workspace-attachment-usage", workspaceId] as const;
}

export function useWorkspaceGoogleDrive(enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: workspaceGoogleDriveQueryKey(workspaceId),
    queryFn: () => getWorkspaceGoogleDrive(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

export function useWorkspaceNasStorage(enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: workspaceNasStorageQueryKey(workspaceId),
    queryFn: () => getWorkspaceNasStorage(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

export function useAttachmentUsage(enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: attachmentUsageQueryKey(workspaceId),
    queryFn: () => getWorkspaceAttachmentUsage(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

/** Invalidate everything the Storage tab reads, including the workspace row (attachment_storage). */
export function useRefreshAttachmentStorage() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceGoogleDriveQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceNasStorageQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: attachmentUsageQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] }),
    ]);
  };
}

export function useSetAttachmentStorage() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshAttachmentStorage();
  return useMutation({
    mutationFn: (mode: AttachmentStorageMode) => setAttachmentStorage(workspaceId, mode),
    onSuccess: async () => {
      await refresh();
      toast.success(t("settings.storage.toast.saved"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.storage.errors.saveFailed"));
    },
  });
}

export function useConnectPhotosGoogleDrive() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (locale: string) => startPhotosGoogleDriveOAuth(workspaceId, locale),
    onSuccess: (url) => {
      window.location.assign(url);
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.storage.errors.connectFailed"));
    },
  });
}

export function useDisconnectPhotosGoogleDrive() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshAttachmentStorage();
  return useMutation({
    mutationFn: () => disconnectPhotosGoogleDrive(workspaceId),
    onSuccess: async () => {
      await refresh();
      toast.success(t("settings.storage.toast.disconnected"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.storage.errors.disconnectFailed"));
    },
  });
}

export function useTestNasConnection() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (payload: NasConnectionPayload) => testNasConnection(workspaceId, payload),
    onSuccess: () => {
      toast.success(t("settings.storage.nas.toast.tested"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.storage.nas.errors.testFailed"));
    },
  });
}

export function useSaveNasConnection() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshAttachmentStorage();
  return useMutation({
    mutationFn: (payload: NasConnectionPayload) => saveNasConnection(workspaceId, payload),
    onSuccess: async () => {
      await refresh();
      toast.success(t("settings.storage.nas.toast.saved"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.storage.nas.errors.saveFailed"));
    },
  });
}

export function useDisconnectNasStorage() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshAttachmentStorage();
  return useMutation({
    mutationFn: () => disconnectNasStorage(workspaceId),
    onSuccess: async () => {
      await refresh();
      toast.success(t("settings.storage.nas.toast.disconnected"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.storage.nas.errors.disconnectFailed"));
    },
  });
}
