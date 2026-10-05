import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setActiveWorkspace as setActiveWorkspaceApi } from "../../services/apiWorkspaces";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { clearWorkspaceQueries, setCachedActiveWorkspace } from "../auth/session";
import i18n from "../../i18n";

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
      toast.success(i18n.t("workspaces.toast.switched"), { id: "set-active" });
    },
    onMutate() {
      toast.loading(i18n.t("workspaces.toast.switching"), { id: "set-active" });
    },
    onError(error) {
      toast.error(error.message || i18n.t("workspaces.toast.switchFailed"), { id: "set-active" });
      if (import.meta.env.DEV) console.error(error);
    },
  });
  return { updateWorkspace, isPending };
}
