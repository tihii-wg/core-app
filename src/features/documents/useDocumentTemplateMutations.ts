import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createDocumentTemplate,
  duplicateDocumentTemplate,
  renameDocumentTemplate,
  saveDocumentTemplateLayout,
  setDefaultDocumentTemplate,
  softDeleteDocumentTemplate,
  type SaveDocumentTemplateLayoutInput,
} from "../../services/apiDocumentTemplates";
import type { DocumentTemplateType } from "./layout";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

function useInvalidateTemplates() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return () => void queryClient.invalidateQueries({ queryKey: ["document-templates", workspaceId] });
}

export function useCreateDocumentTemplate() {
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ documentType, name }: { documentType: DocumentTemplateType; name?: string }) => {
      guardWrite();
      return createDocumentTemplate(documentType, workspaceId, name);
    },
    onSuccess: () => {
      invalidate();
      toast.success(i18n.t("settings.printTemplates.toast.created"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useDuplicateDocumentTemplate() {
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (templateId: string) => {
      guardWrite();
      return duplicateDocumentTemplate(templateId, workspaceId);
    },
    onSuccess: () => {
      invalidate();
      toast.success(i18n.t("settings.printTemplates.toast.duplicated"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useRenameDocumentTemplate() {
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => {
      guardWrite();
      return renameDocumentTemplate(id, name, workspaceId);
    },
    onSuccess: () => {
      invalidate();
      toast.success(i18n.t("settings.printTemplates.toast.renamed"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useDeleteDocumentTemplate() {
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (templateId: string) => {
      guardWrite();
      return softDeleteDocumentTemplate(templateId, workspaceId);
    },
    onSuccess: () => {
      invalidate();
      toast.success(i18n.t("settings.printTemplates.toast.deleted"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useSetDefaultDocumentTemplate() {
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (templateId: string) => {
      guardWrite();
      return setDefaultDocumentTemplate(templateId, workspaceId);
    },
    onSuccess: () => {
      invalidate();
      toast.success(i18n.t("settings.printTemplates.toast.setDefault"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useSaveDocumentTemplateLayout() {
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (input: Omit<SaveDocumentTemplateLayoutInput, "workspaceId">) => {
      guardWrite();
      return saveDocumentTemplateLayout({ ...input, workspaceId });
    },
    onSuccess: () => {
      invalidate();
      toast.success(i18n.t("settings.printTemplates.toast.saved"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
