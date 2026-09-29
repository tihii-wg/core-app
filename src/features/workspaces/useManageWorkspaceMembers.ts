import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
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
      toast.loading("Adding team member...", { id: "team-member" });
    },
    onSuccess(_data, { workspaceId }) {
      void invalidate(workspaceId);
      toast.success("Team member added", { id: "team-member" });
    },
    onError(error) {
      toast.error(error.message || "Could not add the team member", { id: "team-member" });
    },
  });
}

export function useUpdateWorkspaceMemberRole() {
  const invalidate = useInvalidateMembers();

  return useMutation({
    mutationFn: ({ workspaceId, userId, role }: { workspaceId: string; userId: string; role: string }) => updateWorkspaceMemberRole(workspaceId, userId, role),
    onMutate() {
      toast.loading("Updating role...", { id: "team-member" });
    },
    onSuccess(_data, { workspaceId }) {
      void invalidate(workspaceId);
      toast.success("Role updated", { id: "team-member" });
    },
    onError(error, { workspaceId }) {
      void invalidate(workspaceId);
      toast.error(error.message || "Could not update the role", { id: "team-member" });
    },
  });
}

export function useRemoveWorkspaceMember() {
  const invalidate = useInvalidateMembers();

  return useMutation({
    mutationFn: ({ workspaceId, userId }: { workspaceId: string; userId: string }) => removeWorkspaceMember(workspaceId, userId),
    onMutate() {
      toast.loading("Removing team member...", { id: "team-member" });
    },
    onSuccess(_data, { workspaceId }) {
      void invalidate(workspaceId);
      toast.success("Team member removed", { id: "team-member" });
    },
    onError(error) {
      toast.error(error.message || "Could not remove the team member", { id: "team-member" });
    },
  });
}
