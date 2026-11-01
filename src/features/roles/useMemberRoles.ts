import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { assignMemberRole, clearMemberRole, getMemberRoles } from "../../services/apiRoles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useGetMemberRoles() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["member-roles", workspaceId],
    queryFn: () => getMemberRoles(workspaceId),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}

function useMemberRoleMutation<TVariables>(mutationFn: (variables: TVariables, workspaceId: string | undefined) => Promise<void>, successMessage: () => string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (variables: TVariables) => {
      guardWrite();
      return mutationFn(variables, workspaceId);
    },
    onSuccess: () => {
      toast.success(successMessage());
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["member-roles", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["my-permissions", workspaceId] });
    },
  });
}

export function useAssignMemberRole() {
  return useMemberRoleMutation<{ userId: string; roleId: string }>(
    ({ userId, roleId }, workspaceId) => assignMemberRole(workspaceId, userId, roleId),
    () => i18n.t("settings.roles.toast.assigned"),
  );
}

export function useClearMemberRole() {
  return useMemberRoleMutation<{ userId: string }>(
    ({ userId }, workspaceId) => clearMemberRole(workspaceId, userId),
    () => i18n.t("settings.roles.toast.cleared"),
  );
}
