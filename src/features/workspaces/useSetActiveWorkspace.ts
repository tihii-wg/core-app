import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setActiveWorkspace as setActiveWorkspaceApi } from "../../services/apiWorkspace";

export function useSetActiveWorkspace() {
  const queryClient = useQueryClient();

  const { mutate: updateWorkspace, isPending } = useMutation({
    mutationFn: (id: string) => setActiveWorkspaceApi(id),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      // console.log("set type of  workspace");
    },
    onError(error) {
      console.log(error);
    },
  });
  return { updateWorkspace, isPending };
}
