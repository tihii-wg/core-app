import { useQuery } from "@tanstack/react-query";
import { getIndustries, getIndustryCatalog } from "../../services/apiIndustries";

export function useGetIndustries() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["industries"],
    queryFn: getIndustries,
  });

  const industries = !isLoading && !error && (data ?? []).length === 0 ? getIndustryCatalog() : (data ?? []);

  return { industries, isLoading, error };
}
