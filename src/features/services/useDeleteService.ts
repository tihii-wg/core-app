import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteService } from "../../services/apiServices";

export default function useDeleteService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteService,

    onSuccess: () => {
      console.log("DELETE SUCCESS");

      queryClient.invalidateQueries({
        queryKey: ["services"],
      });
    },

    onError: (error) => {
      console.error("DELETE MUTATION ERROR:", error);
    },
  });
}