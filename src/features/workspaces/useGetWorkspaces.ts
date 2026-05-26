import { useQuery } from "@tanstack/react-query";
import { getUserWorkspace } from "../../services/apiWorkspace";

export function useGetWorkspaces() {
  const {
    data: workspaces,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["workspaces"],
    queryFn: getUserWorkspace,

  });
  if (error) {
    throw new Error(error.message);
  }

  return { workspaces, isLoading, error };
}
