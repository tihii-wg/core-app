import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

/** Shared write mutation for Stage 9 modules: subscription guard, list invalidation, success/error toasts. */
export function useStage9Mutation<TVariables>(
  queryKey: string,
  mutationFn: (variables: TVariables, workspaceId: string | undefined) => Promise<unknown>,
  successMessage: () => string,
) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (variables: TVariables) => {
      guardWrite();
      return mutationFn(variables, workspaceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKey, workspaceId] });
      toast.success(successMessage());
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
