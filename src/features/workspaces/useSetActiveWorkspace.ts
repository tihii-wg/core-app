import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setActiveWorkspace as setActiveWorkspaceApi } from "../../services/apiWorkspaces";
import { useLocation, useNavigate, useParams } from "react-router-dom";

export function useSetActiveWorkspace() {
  const navigate = useNavigate();
  const { locale } = useParams();
  const location = useLocation();
  const field = location.pathname.split("/");
  const queryClient = useQueryClient();

  const { mutate: updateWorkspace, isPending } = useMutation({
    mutationFn: (id: string) => setActiveWorkspaceApi(id),
    onSuccess(data) {
      navigate(`/${locale}/${data.id}/${field[3]}`);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },

    onError(error) {
      console.log(error);
    },
  });
  return { updateWorkspace, isPending };
}
