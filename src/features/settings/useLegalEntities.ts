import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createLegalEntity,
  getLegalEntities,
  softDeleteLegalEntity,
  updateLegalEntity,
  type LegalEntityInput,
} from "../../services/apiLegalEntities";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useLegalEntities(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["legal-entities", workspaceId],
    queryFn: () => getLegalEntities(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateLegalEntity(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (input: LegalEntityInput) => {
      if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
      guardWrite();
      return createLegalEntity(workspaceId, input);
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["legal-entities", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      toast.success(i18n.t("settings.general.legalEntities.toast.saved"));
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : i18n.t("settings.general.legalEntities.toast.failed"));
    },
  });
}

export function useUpdateLegalEntity(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: ({ entityId, input }: { entityId: string; input: LegalEntityInput }) => {
      if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
      guardWrite();
      return updateLegalEntity(workspaceId, entityId, input);
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["legal-entities", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      toast.success(i18n.t("settings.general.legalEntities.toast.saved"));
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : i18n.t("settings.general.legalEntities.toast.failed"));
    },
  });
}

export function useDeleteLegalEntity(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (entityId: string) => {
      if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
      guardWrite();
      return softDeleteLegalEntity(workspaceId, entityId);
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["legal-entities", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      toast.success(i18n.t("settings.general.legalEntities.toast.deleted"));
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : i18n.t("settings.general.legalEntities.toast.failed"));
    },
  });
}
