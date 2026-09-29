import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createEmployee } from "../../services/apiEmployees";
import toast from "react-hot-toast";



export default function useCreateNewEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEmployee,
    onMutate: () => {
      toast.loading("Creating employee", { id: "create-employee" });
    },
    onSuccess: (_data, { workspace_id }) => {
      queryClient.invalidateQueries({ queryKey: ["employees", workspace_id] });
      toast.success("Employee created succesfully", { id: "create-employee" });
    },
    onError: (error) => {
      toast.error(error.message || "Somthing went wrong", { id: "create-employee" });
    },
  });
}
