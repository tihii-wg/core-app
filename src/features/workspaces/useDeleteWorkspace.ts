import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteWorkspace as deleteWorkspaceApi } from "../../services/apiWorkspaces";
import { useLocation, useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";

export function useDeleteWorkspace() {
  const navigate = useNavigate();
  const { locale } = useParams();
  const location = useLocation();
  const field = location.pathname.split("/");

  const queryClient = useQueryClient();
  const { mutateAsync: deleteWorkspace, isPending } = useMutation({
    mutationFn: deleteWorkspaceApi,
    onSuccess: ({ nextWorkspaceId }) => {
      navigate(`/${locale}/${nextWorkspaceId}/${field[3]}`);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
  return { deleteWorkspace, isPending };
}
