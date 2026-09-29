import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { deleteService } from "../../services/apiServices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export default function useDeleteService() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (serviceId: string) => deleteService(serviceId, workspaceId),
    onMutate: () => {
      toast.loading("Deleting service", { id: "delete-service" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success("Service deleted", { id: "delete-service" });
    },
    onError: (error) => {
      toast.error(error.message || "Could not delete the service", { id: "delete-service" });
    },
  });
}
