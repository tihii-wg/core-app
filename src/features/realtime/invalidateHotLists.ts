import type { QueryClient } from "@tanstack/react-query";
import { REALTIME_HOT_LIST_ROOTS } from "./realtimeTables";

/**
 * Returning to a background tab fires two refreshes at once: the "was hidden a while" check and the
 * realtime channel re-subscribing after the browser dropped its socket. Within this window the second
 * call is skipped, so the lists are reloaded once, not twice.
 */
const HOT_LIST_DEDUPE_MS = 10_000;
const lastInvalidatedAt = new Map<string, number>();

/** Invalidate hot list/board/detail-driving queries for a workspace (prefix match). */
export function invalidateHotLists(queryClient: QueryClient, workspaceId: string) {
  const now = Date.now();
  const last = lastInvalidatedAt.get(workspaceId);
  if (last != null && now - last < HOT_LIST_DEDUPE_MS) return;
  lastInvalidatedAt.set(workspaceId, now);
  for (const root of REALTIME_HOT_LIST_ROOTS) {
    void queryClient.invalidateQueries({ queryKey: [root, workspaceId] });
  }
}
