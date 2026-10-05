import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteWorkspace as deleteWorkspaceApi } from "../../services/apiWorkspaces";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import useCurrentPage from "../../hooks/useCurrentPage";
import { clearWorkspaceQueries, setCachedActiveWorkspace } from "../auth/session";

export function useDeleteWorkspace() {
  const navigate = useNavigate();
  const { locale } = useParams();

  const currentPage = useCurrentPage();

  const queryClient = useQueryClient();
  const { mutate: deleteWorkspace, isPending } = useMutation({
    mutationFn: deleteWorkspaceApi,
    onSuccess: ({ nextWorkspaceId }) => {
      clearWorkspaceQueries(queryClient);
      setCachedActiveWorkspace(queryClient, nextWorkspaceId);
      navigate(nextWorkspaceId ? `/${locale}/${nextWorkspaceId}/${currentPage}` : `/${locale}/dashboard`);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(i18n.t("settings.workspace.toast.deleted"), { id: "delete" });
    },
    onMutate() {
      toast.loading(i18n.t("common.deleting"), { id: "delete" });
    },
    onError(error) {
      toast.error(error.message || i18n.t("settings.workspace.toast.deleteFailed"), { id: "delete" });
      if (import.meta.env.DEV) console.error(error);
    },
  });
  return { deleteWorkspace, isPending };
}
