import { useQuery } from "@tanstack/react-query";
import { getProfile } from "../../services/apiProfiles";

export function useGetProfile() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["profiles"],
    queryFn: getProfile,
    retry: false,
  });

  return { data, isLoading, error, refetch };
}

// UI context only: which workspace the user is working in. RLS decides what they can access.
export function useActiveWorkspaceId() {
  const { data, isLoading, error } = useGetProfile();
  return { workspaceId: data?.active_workspace_id ?? undefined, isLoading, error };
}
