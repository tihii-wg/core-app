import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createService } from "../../services/apiServices";
import toast from "react-hot-toast";
import type { addNewServiceFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export default function useCreateNewService() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: addNewServiceFormData) => createService(input, workspaceId),
    onMutate: () => {
      toast.loading("Creating service", { id: "create-service" });
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success("Service created succesfully", { id: "create-service" });
    },
    onError: (error) => {
      if (error.message === "service with this name is already exists") {
        toast.error("Service with this name is already exists", { id: "create-service" });
      } else {
        toast.error(error.message || "Somthing went wrong", { id: "create-service" });
      }
    },
  });
}
