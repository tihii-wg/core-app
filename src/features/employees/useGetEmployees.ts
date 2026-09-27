import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getEmployees } from "../../services/apiEmployees";
import type { EmployeeRole } from "../../lib/types";

export default function useGetEmployees(search?: string, roleFilter?: EmployeeRole) {
  const { workspaceId } = useParams();
  const {
    data: employees,
    error,
    isLoading,
    isPending,
  } = useQuery({
    queryKey: ["employees", workspaceId, search, roleFilter],
    queryFn: () => getEmployees(search ?? "", roleFilter),
    enabled: Boolean(workspaceId),
  });

  if (error) throw new Error(error.message);

  return { employees, error, isLoading, isPending };
}
