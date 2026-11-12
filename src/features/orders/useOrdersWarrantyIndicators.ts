import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import type { OrderWarrantyIndicatorModel } from "./warranty";
import { getOrdersWarrantyIndicatorMap } from "../../services/apiWarranty";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

type OrderWarrantyInput = Pick<
  Order,
  | "id"
  | "status"
  | "warrantySourceOrderId"
  | "vehicleId"
  | "vehicleMileageSnapshot"
  | "vehicleMileageUnitSnapshot"
  | "closedAt"
>;

/**
 * Batched warranty indicator map for the current orders page / board set.
 * One query for the visible order ids — never one request per card.
 */
export function useOrdersWarrantyIndicators(
  orders: readonly OrderWarrantyInput[],
  options?: { useMileageWarranty?: boolean },
) {
  const { workspaceId } = useActiveWorkspaceId();
  const useMileageWarranty = options?.useMileageWarranty !== false;
  const orderKey = useMemo(
    () =>
      orders
        .map(
          (order) =>
            `${order.id}:${order.status}:${order.warrantySourceOrderId ?? ""}:${order.vehicleId ?? ""}:${order.closedAt ?? ""}:${order.vehicleMileageSnapshot ?? ""}:${order.vehicleMileageUnitSnapshot ?? ""}`,
        )
        .sort()
        .join("|"),
    [orders],
  );

  const query = useQuery({
    queryKey: ["orders-warranty-indicators", workspaceId, orderKey, useMileageWarranty],
    queryFn: () => getOrdersWarrantyIndicatorMap(workspaceId, orders, undefined, { useMileageWarranty }),
    enabled: Boolean(workspaceId) && orders.length > 0,
    staleTime: 30_000,
    // The key changes whenever an order's status / closedAt changes (e.g. closing an order refreshes the list
    // twice). Keep showing the previous indicators while the new map loads, so the green warranty line does
    // not blink off and on.
    placeholderData: keepPreviousData,
  });

  const byOrderId = useMemo(() => {
    const map = new Map<string, OrderWarrantyIndicatorModel>();
    const data = query.data;
    if (!data) return map;
    for (const [id, model] of Object.entries(data)) map.set(id, model);
    return map;
  }, [query.data]);

  return {
    byOrderId,
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function emptyWarrantyIndicator(): OrderWarrantyIndicatorModel {
  return {
    visible: false,
    isWarrantyOrder: false,
    coveredItemCount: 0,
    status: "none",
    evaluation: null,
    remaining: null,
    nearExpiry: false,
    primary: null,
  };
}
