import { useWorkspaceRealtime } from "./WorkspaceRealtimeProvider";
import { REALTIME_FALLBACK_POLL_MS } from "./realtimeTables";

/**
 * Per-query options for hot lists (orders, payments, dashboard, inventory).
 * Global App defaults keep catalogs quiet; these opt back into focus/reconnect
 * and poll every 60s while the workspace realtime channel is not SUBSCRIBED.
 */
export function useRealtimeHotQueryOptions() {
  const { isSubscribed } = useWorkspaceRealtime();
  return {
    refetchOnWindowFocus: true as const,
    refetchOnReconnect: true as const,
    refetchInterval: isSubscribed ? (false as const) : REALTIME_FALLBACK_POLL_MS,
  };
}
