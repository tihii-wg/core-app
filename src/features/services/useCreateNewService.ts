import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createService } from "../../services/apiServices";
import toast from "react-hot-toast";

export default function useCreateNewService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createService,
    onMutate: () => {
      toast.loading("Creating service", { id: "create-service" });
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      toast.success("Service created succesfully", { id: "create-service" });
    },
    onError: (error) => {
      console.log("onError", error);

      if (error.message === "service with this name is already exists") {
        toast.error("Service with this name is already exists", { id: "create-service" });
      } else {
        toast.error(error.message || "Somthing went wrong", { id: "create-service" });
      }
    },
  });
}
