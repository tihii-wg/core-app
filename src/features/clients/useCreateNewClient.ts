import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "../../services/apiClients";
import toast from "react-hot-toast";

export function useCreateNewClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createClient,
    onMutate: () => {
      toast.loading("Creating Client...", { id: "create-client" });
    },
    onSuccess: (_data, { workspace_id }) => {
      queryClient.invalidateQueries({ queryKey: ["clients", workspace_id] });
      toast.success("Client created succesfully", { id: "create-client" });
    },
    onError: (error) => {
      toast.error(error.message || "Somthing went wrong", { id: "create-client" });
    },
  });
}
