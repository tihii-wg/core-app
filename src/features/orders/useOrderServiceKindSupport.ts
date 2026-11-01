import { useQuery } from "@tanstack/react-query";
import { probeOrderServiceKindSupport } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/** True once a read of `order_services.kind` succeeded, i.e. the column exists in this database. */
export function useOrderServiceKindSupport() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data } = useQuery({
    queryKey: ["order_service_kind_support", workspaceId],
    queryFn: probeOrderServiceKindSupport,
    enabled: Boolean(workspaceId),
    staleTime: Infinity,
    retry: false,
  });
  return data === true;
}
