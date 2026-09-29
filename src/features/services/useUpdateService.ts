import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateService } from "../../services/apiServices";
import toast from "react-hot-toast";
import type { addNewServiceFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export default function useUpdateService() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: addNewServiceFormData) => updateService(input, workspaceId),
    onMutate: () => {
      toast.loading("Updating service", { id: "update-service" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success("Service was updated", { id: "update-service" });
    },
    onError: (error) => {
      toast.error(error.message || "Somthing went wrong", { id: "update-service" });
    },
  });
}
