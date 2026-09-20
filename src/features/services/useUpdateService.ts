import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateService } from "../../services/apiServices";
import toast from "react-hot-toast";

export default function useUpdateService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateService,
    onMutate: () => {
      toast.loading("Updating service", { id: "update-service" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      toast.success("Service was updated", { id: "update-service" });
    },
    onError: (error) => {
      console.log(error);
      toast.error(error.message || "Somthing went wrong", { id: "update-service" });
    },
  });
}
