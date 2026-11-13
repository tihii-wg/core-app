import type { QueryClient } from "@tanstack/react-query";
import { REALTIME_HOT_LIST_ROOTS } from "./realtimeTables";

/** Invalidate hot list/board/detail-driving queries for a workspace (prefix match). */
export function invalidateHotLists(queryClient: QueryClient, workspaceId: string) {
  for (const root of REALTIME_HOT_LIST_ROOTS) {
    void queryClient.invalidateQueries({ queryKey: [root, workspaceId] });
  }
}
