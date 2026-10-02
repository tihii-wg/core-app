import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { getWorkspaceLogoUrl, LOGO_REMOVE_ERROR, LOGO_UPLOAD_ERROR, removeWorkspaceLogo, uploadWorkspaceLogo } from "./workspaceAvatar";
import type { ListedWorkspaceMembership, WorkspaceDetails } from "../../services/apiWorkspaces";


export function useWorkspaceAvatar(workspaceId?: string, avatarPath?: string | null) {
  return useQuery({
    queryKey: ["workspace-avatar", workspaceId, avatarPath],
    queryFn: () => getWorkspaceLogoUrl(workspaceId ?? "", avatarPath),
    enabled: Boolean(workspaceId && avatarPath),
    staleTime: 50 * 60 * 1000,
    retry: false,
  });
}

export function useUploadWorkspaceAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, file }: { workspaceId: string; file: Blob }) => uploadWorkspaceLogo(workspaceId, file),
    onSuccess(_path, { workspaceId }) {
      invalidateWorkspaceLogo(queryClient, workspaceId);
      toast.success("Company logo uploaded successfully.");
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : LOGO_UPLOAD_ERROR);
    },
  });
}

export function useRemoveWorkspaceAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, avatarPath }: { workspaceId: string; avatarPath: string | null }) => removeWorkspaceLogo(workspaceId, avatarPath),
    onSuccess(_data, { workspaceId }) {
      clearWorkspaceLogo(queryClient, workspaceId);
      toast.success("Company logo removed successfully.");
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : LOGO_REMOVE_ERROR);
    },
  });
}

function invalidateWorkspaceLogo(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string) {
  queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  queryClient.invalidateQueries({ queryKey: ["workspace-avatar", workspaceId] });
}

// The deleted object must never be signed again: the cached workspaces stop pointing at it before
// any refetch, and its signed-URL query is neither invalidated nor removed (either would make a
// component still rendering the old path fetch it again); it is left to garbage collection.
function clearWorkspaceLogo(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string) {
  queryClient.setQueryData<WorkspaceDetails | null>(["workspace", workspaceId], (workspace) => (workspace ? { ...workspace, avatarPath: null } : workspace));
  const clear = <T extends { id: string }>(entry: T) => (entry.id === workspaceId ? { ...entry, avatar_path: null } : entry);
  queryClient.setQueryData<ListedWorkspaceMembership[]>(["workspaces"], (memberships) =>
    memberships?.map((membership) => {
      const workspaces = membership.workspaces;
      if (!workspaces) return membership;
      return { ...membership, workspaces: Array.isArray(workspaces) ? workspaces.map(clear) : clear(workspaces) };
    }),
  );
  queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["workspaces"] });
}
