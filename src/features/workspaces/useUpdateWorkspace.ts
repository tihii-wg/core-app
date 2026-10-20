import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { WorkspaceCompanyFields, WorkspaceContactSettings, WorkspaceInvoiceSettings, WorkspaceOrderSettings } from "../../lib/workspaceGeneralSettings";
import {
  updateWorkspaceContactSettings,
  updateWorkspaceDetails,
  updateWorkspaceInvoiceSettings,
  updateWorkspaceOrderSettings,
  updateWorkspacePreferences,
  type WorkspacePreferencesInput,
} from "../../services/apiWorkspaces";

type UpdateWorkspaceInput = {
  workspaceId: string;
  name: string;
  industryId: string;
  inventoryMarkup: number;
} & Partial<WorkspaceCompanyFields>;

function invalidateWorkspace(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string, workspace: unknown) {
  queryClient.setQueryData(["workspace", workspaceId], workspace);
  queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  queryClient.invalidateQueries({ queryKey: ["workspace-markup", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["legal-entities", workspaceId] });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, ...input }: UpdateWorkspaceInput) => updateWorkspaceDetails(workspaceId, input),
    onMutate() {
      toast.loading(i18n.t("settings.company.toast.saving"), { id: "update-workspace" });
    },
    onSuccess(workspace, { workspaceId }) {
      invalidateWorkspace(queryClient, workspaceId, workspace);
      toast.success(i18n.t("settings.company.toast.updated"), { id: "update-workspace" });
    },
    onError(error) {
      toast.error(error.message || i18n.t("settings.company.toast.updateFailed"), { id: "update-workspace" });
    },
  });
}

export function useUpdateWorkspacePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, ...preferences }: WorkspacePreferencesInput & { workspaceId: string }) => updateWorkspacePreferences(workspaceId, preferences),
    onSuccess(workspace) {
      if (!workspace) return;
      invalidateWorkspace(queryClient, workspace.id, workspace);
    },
  });
}

export function useUpdateWorkspaceOrderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, ...input }: WorkspaceOrderSettings & { workspaceId: string }) => updateWorkspaceOrderSettings(workspaceId, input),
    onSuccess(workspace) {
      invalidateWorkspace(queryClient, workspace.id, workspace);
    },
  });
}

export function useUpdateWorkspaceContactSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, ...input }: WorkspaceContactSettings & { workspaceId: string }) => updateWorkspaceContactSettings(workspaceId, input),
    onSuccess(workspace) {
      invalidateWorkspace(queryClient, workspace.id, workspace);
    },
  });
}

export function useUpdateWorkspaceInvoiceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...input
    }: WorkspaceInvoiceSettings & { workspaceId: string; invoiceNextNumber?: number }) => updateWorkspaceInvoiceSettings(workspaceId, input),
    onSuccess(workspace) {
      invalidateWorkspace(queryClient, workspace.id, workspace);
    },
  });
}
