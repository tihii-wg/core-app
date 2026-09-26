import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateClient } from "../../services/apiClients";

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateClient,
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
