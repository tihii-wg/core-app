import { useQuery } from "@tanstack/react-query";
import { getUserWorkspace} from "../../services/apiWorlspace";

export function useWorkspaces() {
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
