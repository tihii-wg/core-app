import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createStatusDefinition, type CreateStatusDefinitionInput } from "../../services/apiStatusDefinitions";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useCreateStatusDefinition() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (input: CreateStatusDefinitionInput) => {
      guardWrite();
      return createStatusDefinition(input, workspaceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["status_definitions", workspaceId] });
      toast.success(i18n.t("settings.statuses.toast.created"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
