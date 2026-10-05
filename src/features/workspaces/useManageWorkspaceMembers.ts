import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { addWorkspaceMember, removeWorkspaceMember, updateWorkspaceMemberRole } from "../../services/apiWorkspaces";

function useInvalidateMembers() {
  const queryClient = useQueryClient();
  return (workspaceId: string) => queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
}

export function useAddWorkspaceMember() {
  const invalidate = useInvalidateMembers();

  return useMutation({
    mutationFn: ({ workspaceId, email, role }: { workspaceId: string; email: string; role: string }) => addWorkspaceMember(workspaceId, { email, role }),
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

  return useMutation({
    mutationFn: ({ workspaceId, userId, role }: { workspaceId: string; userId: string; role: string }) => updateWorkspaceMemberRole(workspaceId, userId, role),
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

  return useMutation({
    mutationFn: ({ workspaceId, userId }: { workspaceId: string; userId: string }) => removeWorkspaceMember(workspaceId, userId),
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
