import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateClient } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: Parameters<typeof updateClient>[0]) => updateClient(input, workspaceId),
    onMutate: () => {
      toast.loading("Updating client...", { id: "update-client" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      toast.success("Client updated successfully", { id: "update-client" });
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong", { id: "update-client" });
    },
  });
}
