import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteWorkspace as deleteWorkspaceApi } from "../../services/apiWorkspaces";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import useCurrentPage from "../../hooks/useCurrentPage";
import { clearWorkspaceQueries } from "../auth/session";

export function useDeleteWorkspace() {
  const navigate = useNavigate();
  const { locale } = useParams();

  const currentPage = useCurrentPage();

  const queryClient = useQueryClient();
  const { mutate: deleteWorkspace, isPending } = useMutation({
    mutationFn: deleteWorkspaceApi,
    onSuccess: ({ nextWorkspaceId }) => {
      clearWorkspaceQueries(queryClient);
      navigate(`/${locale}/${nextWorkspaceId}/${currentPage}`);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Workspace was deleted!", { id: "delete" });
    },
    onMutate() {
      toast.loading("Deleting...", { id: "delete" });
    },
    onError(error) {
      toast.error("Could not delete workspace", { id: "delete" });
      if (import.meta.env.DEV) console.error(error);
    },
  });
  return { deleteWorkspace, isPending };
}
