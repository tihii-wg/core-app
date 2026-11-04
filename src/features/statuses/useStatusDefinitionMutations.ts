import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  deleteStatusDefinition,
  reorderStatusDefinitions,
  replaceOrderStatus,
  setDefaultStatusDefinition,
  setOrderLifecycleSemantic,
  updateStatusDefinition,
  type StatusSemanticAction,
  type UpdateStatusDefinitionInput,
} from "../../services/apiStatusDefinitions";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

function invalidateStatuses(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined) {
  void queryClient.invalidateQueries({ queryKey: ["status_definitions", workspaceId] });
}

export function useUpdateStatusDefinition() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (input: UpdateStatusDefinitionInput) => {
      guardWrite();
      return updateStatusDefinition(input, workspaceId);
    },
    onSuccess: () => {
      invalidateStatuses(queryClient, workspaceId);
      toast.success(i18n.t("settings.statuses.toast.updated"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useSetDefaultStatusDefinition() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (statusId: string) => {
      guardWrite();
      return setDefaultStatusDefinition(statusId, workspaceId);
    },
    onSuccess: () => {
      invalidateStatuses(queryClient, workspaceId);
      toast.success(i18n.t("settings.statuses.toast.defaultSet"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useReorderStatusDefinitions() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (orderedIds: string[]) => {
      guardWrite();
      return reorderStatusDefinitions(orderedIds, workspaceId);
    },
    onSuccess: () => {
      invalidateStatuses(queryClient, workspaceId);
      toast.success(i18n.t("settings.statuses.toast.reordered"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useDeleteStatusDefinition() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (statusId: string) => {
      guardWrite();
      return deleteStatusDefinition(statusId, workspaceId);
    },
    onSuccess: () => {
      invalidateStatuses(queryClient, workspaceId);
      toast.success(i18n.t("settings.statuses.toast.deleted"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useSetOrderLifecycleSemantic() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (input: { statusId: string; action: StatusSemanticAction }) => {
      guardWrite();
      return setOrderLifecycleSemantic(input.statusId, input.action, workspaceId);
    },
    onSuccess: () => {
      invalidateStatuses(queryClient, workspaceId);
      toast.success(i18n.t("settings.statuses.toast.semanticUpdated"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useReplaceOrderStatus() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (input: { fromStatusId: string; toStatusId: string }) => {
      guardWrite();
      return replaceOrderStatus(input.fromStatusId, input.toStatusId, workspaceId);
    },
    onSuccess: () => {
      invalidateStatuses(queryClient, workspaceId);
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      toast.success(i18n.t("settings.statuses.toast.replaced"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
