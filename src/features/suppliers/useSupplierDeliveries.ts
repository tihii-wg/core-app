import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getSupplierDeliveries, getSupplierParts } from "../../services/apiWarehouseOps";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useSupplierDeliveries(supplierName: string | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const name = supplierName?.trim() ?? "";

  return useInfiniteQuery({
    queryKey: ["supplier-deliveries", workspaceId, name],
    queryFn: ({ pageParam }) => getSupplierDeliveries(workspaceId, name, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: Boolean(workspaceId) && Boolean(name),
  });
}

export function useSupplierParts(supplierName: string | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const name = supplierName?.trim() ?? "";

  return useQuery({
    queryKey: ["supplier-parts", workspaceId, name],
    queryFn: () => getSupplierParts(workspaceId, name),
    enabled: Boolean(workspaceId) && Boolean(name),
  });
}
