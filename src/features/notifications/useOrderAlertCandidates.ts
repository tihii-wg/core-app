import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOrderAlertCandidates } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

const ALERTS_STALE_MS = 60_000;

/**
 * Open orders for the top-bar bell. Deliberately NOT under the ["orders", workspaceId] prefix: every order save
 * invalidates that prefix, and the bell (mounted on every page) would re-read and re-hydrate its list each time.
 * Alerts are deadline / assignee based, so a minute of staleness is fine; opening the menu refreshes a stale list.
 */
export function useOrderAlertCandidates({ enabled, menuOpen }: { enabled: boolean; menuOpen: boolean }) {
  const { workspaceId } = useActiveWorkspaceId();
  const query = useQuery({
    queryKey: ["order-alerts", workspaceId],
    queryFn: () => getOrderAlertCandidates(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: ALERTS_STALE_MS,
    refetchInterval: 5 * ALERTS_STALE_MS,
    refetchIntervalInBackground: false,
  });

  const { isStale, refetch, isFetching } = query;
  useEffect(() => {
    if (menuOpen && enabled && isStale && !isFetching) void refetch();
    // Only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  return { orders: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
