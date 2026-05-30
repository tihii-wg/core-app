import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "../../services/apiAuth";

export function useUser() {
  const {
    data: user,
    isLoading,
    isFetching,
    isFetched,
  } = useQuery({
    queryKey: ["user"],
    queryFn: getCurrentUser,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  return { user, isLoadingSession: isFetching || isLoading, isAuthenticated: !!user, isReady: isFetched };
}
