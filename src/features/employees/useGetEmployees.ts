import { useQuery } from "@tanstack/react-query";
import { getEmployees } from "../../services/apiEmployees";

export default function useGetEmployees(search: string) {
  const {
    data: employees,
    error,
    isLoading,
    isPending,
  } = useQuery({
    queryKey: ["employees", search],
    queryFn: async () => {
      return await getEmployees(search);
    },
  });

  if (error) throw new Error(error.message);

  return { employees, error, isLoading, isPending };
}
