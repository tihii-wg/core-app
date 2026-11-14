import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import supabase from "../../services/supabase";
import { useUser } from "../auth/useUser";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { invalidateHotLists } from "./invalidateHotLists";
import { isOrderEditRelevantTable, mapRealtimeTableToQueryKeys } from "./mapRealtimeTableToQueryKeys";
import {
  REALTIME_HIDDEN_INVALIDATE_MS,
  REALTIME_INVALIDATE_DEBOUNCE_MS,
  REALTIME_WORKSPACE_TABLES,
} from "./realtimeTables";

export type RealtimeSubscribeStatus =
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CLOSED"
  | "CHANNEL_ERROR";

export type WorkspaceRealtimeContextValue = {
  channelStatus: RealtimeSubscribeStatus;
  isSubscribed: boolean;
  /** Monotonic clock bumped when order-related tables invalidate (edit-form notice). */
  ordersTouchAt: number;
};

const WorkspaceRealtimeContext = createContext<WorkspaceRealtimeContextValue>({
  channelStatus: "SUBSCRIBED",
  isSubscribed: true,
  ordersTouchAt: 0,
});

export function useWorkspaceRealtime(): WorkspaceRealtimeContextValue {
  return useContext(WorkspaceRealtimeContext);
}

type Props = { children: ReactNode };

/**
 * One Supabase Realtime channel per active workspace (mounted once in AppLayout).
 * On postgres_changes: debounce → invalidate React Query keys only (no payload merge).
 * supabase-js already calls realtime.setAuth on TOKEN_REFRESHED / SIGNED_IN.
 */
export function WorkspaceRealtimeProvider({ children }: Props) {
  const { workspaceId } = useActiveWorkspaceId();
  const { user } = useUser();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [channelStatus, setChannelStatus] = useState<RealtimeSubscribeStatus>("CLOSED");
  const [ordersTouchAt, setOrdersTouchAt] = useState(0);

  const pendingTablesRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggedErrorRef = useRef(false);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  const flushInvalidations = useCallback(() => {
    const ws = workspaceIdRef.current;
    if (!ws) {
      pendingTablesRef.current.clear();
      return;
    }
    const tables = [...pendingTablesRef.current];
    pendingTablesRef.current.clear();
    if (tables.length === 0) return;

    const keys = new Map<string, ReturnType<typeof mapRealtimeTableToQueryKeys>[number]>();
    let touchOrders = false;
    for (const table of tables) {
      if (isOrderEditRelevantTable(table)) touchOrders = true;
      for (const key of mapRealtimeTableToQueryKeys(table, ws)) {
        keys.set(JSON.stringify(key), key);
      }
    }
    for (const key of keys.values()) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
    if (touchOrders) setOrdersTouchAt(Date.now());
  }, [queryClient]);

  const scheduleInvalidate = useCallback(
    (table: string) => {
      pendingTablesRef.current.add(table);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        flushInvalidations();
      }, REALTIME_INVALIDATE_DEBOUNCE_MS);
    },
    [flushInvalidations],
  );

  useEffect(() => {
    if (!workspaceId || !userId) {
      setChannelStatus("CLOSED");
      return;
    }

    loggedErrorRef.current = false;
    let cancelled = false;
    // First SUBSCRIBED right after page load: data was just fetched — skip the catch-up refetch.
    // Only a RE-subscribe (after an error/timeout) needs it, to pick up changes missed meanwhile.
    let everSubscribed = false;

    // Defensive: environments without Realtime (tests, misconfigured client) must not crash the app shell.
    if (typeof supabase.channel !== "function") {
      setChannelStatus("CLOSED");
      return;
    }
    let channel = supabase.channel(`ws:${workspaceId}`);
    for (const table of REALTIME_WORKSPACE_TABLES) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const name = payload.table ?? table;
          scheduleInvalidate(name);
        },
      );
    }

    channel.subscribe((status) => {
      if (cancelled) return;
      const next = status as RealtimeSubscribeStatus;
      setChannelStatus(next);
      if (next === "SUBSCRIBED") {
        if (everSubscribed) invalidateHotLists(queryClient, workspaceId);
        everSubscribed = true;
      }
      if ((next === "CHANNEL_ERROR" || next === "TIMED_OUT") && !loggedErrorRef.current) {
        loggedErrorRef.current = true;
        console.warn("[realtime] workspace channel", next, workspaceId);
      }
    });

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingTablesRef.current.clear();
      if (channel) void supabase.removeChannel(channel);
      setChannelStatus("CLOSED");
    };
  }, [workspaceId, userId, queryClient, scheduleInvalidate]);

  // After a long background (mobile drops sockets), invalidate hot lists once on return.
  useEffect(() => {
    if (!workspaceId || !userId) return;
    let hiddenAt: number | null = null;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt != null && Date.now() - hiddenAt >= REALTIME_HIDDEN_INVALIDATE_MS) {
        invalidateHotLists(queryClient, workspaceId);
      }
      hiddenAt = null;
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [workspaceId, userId, queryClient]);

  const value = useMemo<WorkspaceRealtimeContextValue>(
    () => ({
      channelStatus,
      isSubscribed: channelStatus === "SUBSCRIBED",
      ordersTouchAt,
    }),
    [channelStatus, ordersTouchAt],
  );

  return (
    <WorkspaceRealtimeContext.Provider value={value}>{children}</WorkspaceRealtimeContext.Provider>
  );
}
