import { useQuery } from "@tanstack/react-query";
import { getProfile } from "../../services/apiProfiles";

export function useGetProfile() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: getProfile,
    retry: false,
  });

  return { data, isLoading, error };
}
