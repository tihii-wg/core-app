import { useQuery } from "@tanstack/react-query";
import { getUserWorkspaces } from "../../services/apiWorkspaces";

export function useGetWorkspaces() {
  const {
    data: workspaces,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["workspaces"],
    queryFn: getUserWorkspaces,
  });
  return { workspaces, isLoading, error };
}
