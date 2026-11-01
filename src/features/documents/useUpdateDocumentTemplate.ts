import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateDocumentTemplateBody } from "../../services/apiDocumentTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useUpdateDocumentTemplateBody() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: ({ id, bodyHtml }: { id: string; bodyHtml: string }) => {
      guardWrite();
      return updateDocumentTemplateBody(id, bodyHtml, workspaceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["document-templates", workspaceId] });
      toast.success(i18n.t("settings.printTemplates.toast.saved"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
