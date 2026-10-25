import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { addWorkspaceMember, removeWorkspaceMember, updateWorkspaceMemberRole } from "../../services/apiWorkspaces";
import { useGuardSubscriptionWrite } from "./useWorkspaceSubscription";

function useInvalidateMembers() {
  const queryClient = useQueryClient();
  return (workspaceId: string) => queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
}

export function useAddWorkspaceMember() {
  const invalidate = useInvalidateMembers();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ workspaceId, email, role }: { workspaceId: string; email: string; role: string }) => {
      guardWrite();
      return addWorkspaceMember(workspaceId, { email, role });
    },
    onMutate() {
      toast.loading(i18n.t("team.toast.adding"), { id: "team-member" });
    },
    onSuccess(_data, { workspaceId }) {
      void invalidate(workspaceId);
      toast.success(i18n.t("team.toast.added"), { id: "team-member" });
    },
    onError(error) {
      toast.error(error.message || i18n.t("team.toast.addFailed"), { id: "team-member" });
    },
  });
}

export function useUpdateWorkspaceMemberRole() {
  const invalidate = useInvalidateMembers();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ workspaceId, userId, role }: { workspaceId: string; userId: string; role: string }) => {
      guardWrite();
      return updateWorkspaceMemberRole(workspaceId, userId, role);
    },
    onMutate() {
      toast.loading(i18n.t("team.toast.updatingRole"), { id: "team-member" });
    },
    onSuccess(_data, { workspaceId }) {
      void invalidate(workspaceId);
      toast.success(i18n.t("team.toast.roleUpdated"), { id: "team-member" });
    },
    onError(error, { workspaceId }) {
      void invalidate(workspaceId);
      toast.error(error.message || i18n.t("team.toast.roleUpdateFailed"), { id: "team-member" });
    },
  });
}

export function useRemoveWorkspaceMember() {
  const invalidate = useInvalidateMembers();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ workspaceId, userId }: { workspaceId: string; userId: string }) => {
      guardWrite();
      return removeWorkspaceMember(workspaceId, userId);
    },
    onMutate() {
      toast.loading(i18n.t("team.toast.removing"), { id: "team-member" });
    },
    onSuccess(_data, { workspaceId }) {
      void invalidate(workspaceId);
      toast.success(i18n.t("team.toast.removed"), { id: "team-member" });
    },
    onError(error) {
      toast.error(error.message || i18n.t("team.toast.removeFailed"), { id: "team-member" });
    },
  });
}
