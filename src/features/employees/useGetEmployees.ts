import { useQuery } from "@tanstack/react-query";
import { getEmployees } from "../../services/apiEmployees";
import type { EmployeeRole } from "../../lib/types";

export default function useGetEmployees(search: string, roleFilter: EmployeeRole) {
  const {
    data: employees,
    error,
    isLoading,
    isPending,
  } = useQuery({
    queryKey: ["employees", search, roleFilter],
    queryFn: () => getEmployees(search, roleFilter),
  });

  if (error) throw new Error(error.message);

  return { employees, error, isLoading, isPending };
}
