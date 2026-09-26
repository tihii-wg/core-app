import { useQuery } from "@tanstack/react-query";
import { getOrders } from "../../services/apiOrders";

export function useGetOrders() {
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ["orders"],
    queryFn: getOrders,
  });

  if (error) throw new Error(error.message);

  return { orders: orders ?? [], isLoading };
}
