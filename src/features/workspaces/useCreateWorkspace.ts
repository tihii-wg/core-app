import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";
import { createWorkspace, setActiveWorkspace } from "../../services/apiWorkspaces";
import { clearWorkspaceQueries, setCachedActiveWorkspace } from "../auth/session";
import i18n from "../../i18n";

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { locale = "en" } = useParams();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: async (data) => {
      const workspaceId = data?.[0]?.id ? String(data[0].id) : null;
      toast.success(i18n.t("workspaces.toast.created"), { id: "create-workspace" });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (!workspaceId) return;
      try {
        const activeId = await setActiveWorkspace(workspaceId);
        clearWorkspaceQueries(queryClient);
        setCachedActiveWorkspace(queryClient, activeId);
        queryClient.invalidateQueries({ queryKey: ["profiles"] });
        navigate(`/${locale}/${activeId}/dashboard`, { replace: true });
      } catch {
        // DashboardRedirect will pick up the membership on the next poll/focus.
      }
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("workspaces.toast.createFailed"), { id: "create-workspace" });
    },
  });
}
