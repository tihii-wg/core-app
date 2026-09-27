import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "../../services/apiAuth";

export function useUser() {
  const { data: user, isPending, isFetched } = useQuery({
    queryKey: ["user"],
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  return {
    user: user ?? null,
    isLoadingSession: isPending,
    isAuthenticated: Boolean(user),
    isReady: isFetched,
  };
}
