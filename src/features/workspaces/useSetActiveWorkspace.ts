import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setActiveWorkspace as setActiveWorkspaceApi } from "../../services/apiWorkspaces";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { clearWorkspaceQueries, setCachedActiveWorkspace } from "../auth/session";

export function useSetActiveWorkspace() {
  const navigate = useNavigate();
  const { locale } = useParams();
  const location = useLocation();
  const field = location.pathname.split("/");
  const queryClient = useQueryClient();

  const { mutateAsync: updateWorkspace, isPending } = useMutation({
    mutationFn: (id: string) => setActiveWorkspaceApi(id),
    onSuccess(data) {
      clearWorkspaceQueries(queryClient);
      setCachedActiveWorkspace(queryClient, data);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/${locale}/${data}/${field[3] || "dashboard"}`);
      toast.success("Workspace was chenged", { id: "set-active" });
    },
    onMutate() {
      toast.loading("Chenging...", { id: "set-active" });
    },
    onError(error) {
      toast.error(error.message || "Could not switch workspace", { id: "set-active" });
      if (import.meta.env.DEV) console.error(error);
    },
  });
  return { updateWorkspace, isPending };
}
