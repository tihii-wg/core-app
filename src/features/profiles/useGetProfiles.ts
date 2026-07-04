import { useQuery } from "@tanstack/react-query";
import { getProfiles } from "../../services/apiProfiles";

export function useGetProfiles() {
  const {
    data,
    error,
    isLoading,
  } = useQuery({
    queryKey: ["profiles"],
    queryFn: getProfiles,
  });
  if (error) throw new Error(error.message);

  return { data, isLoading, error };
}
