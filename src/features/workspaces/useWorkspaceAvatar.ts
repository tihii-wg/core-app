import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { getWorkspaceLogoUrl, LOGO_REMOVE_ERROR, LOGO_UPLOAD_ERROR, removeWorkspaceLogo, uploadWorkspaceLogo } from "../../services/workspaceAvatar";

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
      invalidateWorkspaceLogo(queryClient, workspaceId);
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
