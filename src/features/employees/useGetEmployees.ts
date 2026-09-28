import { useQuery } from "@tanstack/react-query";
import { getEmployees } from "../../services/apiEmployees";
import type { EmployeeRole } from "../../lib/types";
import { useGetProfile } from "../profiles/useGetProfile";

export default function useGetEmployees(search?: string, roleFilter?: EmployeeRole | null) {
  const { data: profile, isLoading: profileLoading, error: profileError } = useGetProfile();
  const activeWorkspaceId = profile?.active_workspace_id ?? undefined;
  const {
    data: employees,
    error,
    isLoading,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ["employees", activeWorkspaceId, search, roleFilter],
    queryFn: () => getEmployees(search ?? "", roleFilter, activeWorkspaceId),
    enabled: Boolean(activeWorkspaceId),
  });

  return {
    employees,
    error: profileError ?? error,
    isLoading: profileLoading || isLoading,
    isPending,
    refetch,
  };
}
