import { useQuery } from "@tanstack/react-query";
import { probeOrderMaterialFreeformSupport } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/**
 * True once a read of `order_materials.supply_source` succeeded (PART E applied).
 * Until then, one-time / customer-supplied material modes stay hidden to avoid rolled-back saves.
 */
export function useOrderMaterialFreeformSupport() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isFetched } = useQuery({
    queryKey: ["order_material_freeform_support", workspaceId],
    queryFn: probeOrderMaterialFreeformSupport,
    enabled: Boolean(workspaceId),
    staleTime: Infinity,
    retry: false,
  });
  return { supported: data === true, ready: isFetched || !workspaceId };
}
