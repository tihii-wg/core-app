import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "../../services/apiClient";

export function useCreateNewClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}
