import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { updateClient } from "../../services/apiClients";

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const { workspaceId } = useParams();

  return useMutation({
    mutationFn: (input: Parameters<typeof updateClient>[0]) => updateClient(input, workspaceId),
    onMutate: () => {
      toast.loading("Updating client...", { id: "update-client" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client updated successfully", { id: "update-client" });
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong", { id: "update-client" });
    },
  });
}
