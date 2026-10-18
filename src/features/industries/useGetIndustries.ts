import { useQuery } from "@tanstack/react-query";
import { getIndustries, IndustriesQueryError } from "../../services/apiIndustries";

export function useGetIndustries() {
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["industries"],
    queryFn: getIndustries,
    retry: (failureCount, queryError) => !(queryError instanceof IndustriesQueryError) && failureCount < 3,
  });

  return { industries: data ?? [], isLoading, isFetching, error, refetch };
}
