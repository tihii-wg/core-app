import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getEmployees } from "../../services/apiEmployees";
import type { EmployeeRole } from "../../lib/types";

export default function useGetEmployees(search?: string, roleFilter?: EmployeeRole | null) {
  const { workspaceId } = useParams();
  const {
    data: employees,
    error,
    isLoading,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ["employees", workspaceId, search, roleFilter],
    queryFn: () => getEmployees(search ?? "", roleFilter, workspaceId),
    enabled: Boolean(workspaceId),
  });

  return { employees, error, isLoading, isPending, refetch };
}
