import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  connectGitHubBackup,
  disconnectBackup,
  getBackupSettings,
  invokeWorkspaceBackup,
  listBackupRuns,
  requestBackupRun,
  startGoogleDriveOAuth,
  updateBackupSettings,
  type BackupSettingsPatch,
} from "../../../services/apiBackups";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";

export function backupSettingsQueryKey(workspaceId: string | undefined) {
  return ["backup-settings", workspaceId] as const;
}

export function backupRunsQueryKey(workspaceId: string | undefined) {
  return ["backup-runs", workspaceId] as const;
}

export function useBackupSettings(enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: backupSettingsQueryKey(workspaceId),
    queryFn: () => getBackupSettings(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

export function useBackupRuns(enabled = true, refetchInterval?: number | false) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: backupRunsQueryKey(workspaceId),
    queryFn: () => listBackupRuns(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    refetchInterval,
    retry: false,
  });
}

export function useUpdateBackupSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (patch: BackupSettingsPatch) => updateBackupSettings(workspaceId, patch),
    onSuccess: (settings) => {
      queryClient.setQueryData(backupSettingsQueryKey(workspaceId), settings);
      toast.success(t("settings.backups.toast.saved"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.backups.errors.saveFailed"));
    },
  });
}

export function useDisconnectBackup() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: () => disconnectBackup(workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: backupSettingsQueryKey(workspaceId) });
      toast.success(t("settings.backups.toast.disconnected"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.backups.errors.disconnectFailed"));
    },
  });
}

export function useConnectGoogleDrive() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (locale: string) => startGoogleDriveOAuth(workspaceId, locale),
    onSuccess: (url) => {
      window.location.assign(url);
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.backups.errors.connectFailed"));
    },
  });
}

export function useConnectGitHub() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (input: { repo: string; branch?: string; path?: string; token: string }) =>
      connectGitHubBackup({ ...input, workspaceId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: backupSettingsQueryKey(workspaceId) });
      toast.success(t("settings.backups.toast.connectedGitHub"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.backups.errors.connectFailed"));
    },
  });
}

export function useRunBackup() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: async (opts: { download: boolean }) => {
      const runId = await requestBackupRun(workspaceId);
      const result = await invokeWorkspaceBackup({ workspaceId, runId, download: opts.download });
      return { runId, ...result };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: backupRunsQueryKey(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: backupSettingsQueryKey(workspaceId) }),
      ]);
      if (result.blob && result.fileName) {
        const url = URL.createObjectURL(result.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        toast.success(t("settings.backups.toast.downloaded"));
        return;
      }
      toast.success(t("settings.backups.toast.runStarted"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("settings.backups.errors.runFailed"));
    },
  });
}
