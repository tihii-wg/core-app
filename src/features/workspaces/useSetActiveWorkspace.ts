import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setActiveWorkspace as setActiveWorkspaceApi } from "../../services/apiWorkspaces";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

export function useSetActiveWorkspace() {
  const navigate = useNavigate();
  const { locale } = useParams();
  const location = useLocation();
  const field = location.pathname.split("/");
  const queryClient = useQueryClient();

  const { mutateAsync: updateWorkspace, isPending } = useMutation({
    mutationFn: (id: string) => setActiveWorkspaceApi(id),
    onSuccess(data) {
      navigate(`/${locale}/${data}/${field[3]}`);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Workspace was chenged", { id: "set-active" });
    },
    onMutate() {
      toast.loading("Chenging...", { id: "set-active" });
    },
    onError(error) {
      console.log(error);
    },
  });
  return { updateWorkspace, isPending };
}
