import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { REALTIME_INVALIDATE_DEBOUNCE_MS, REALTIME_WORKSPACE_TABLES } from "./realtimeTables";
import { useRealtimeHotQueryOptions } from "./useRealtimeHotQueryOptions";
import { useWorkspaceRealtime, WorkspaceRealtimeProvider } from "./WorkspaceRealtimeProvider";

const profileState = { workspaceId: "ws-1" as string | undefined };
const userState = { user: { id: "user-1" } as { id: string } | null };

type ChangeHandler = (payload: { table?: string }) => void;

const channelState = {
  handlers: [] as Array<{ table: string; filter: string; cb: ChangeHandler }>,
  subscribeCb: null as null | ((status: string) => void),
  channel: null as null | ReturnType<typeof buildChannel>,
};

function buildChannel() {
  const channel = {
    on: vi.fn((_type: string, filter: { table: string; filter: string }, cb: ChangeHandler) => {
      channelState.handlers.push({ table: filter.table, filter: filter.filter, cb });
      return channel;
    }),
    subscribe: vi.fn((cb: (status: string) => void) => {
      channelState.subscribeCb = cb;
      return channel;
    }),
  };
  channelState.channel = channel;
  return channel;
}

const removeChannel = vi.fn(async () => "ok");
const channelFactory = vi.fn(() => buildChannel());

vi.mock("../../services/supabase", () => ({
  default: {
    channel: (...args: unknown[]) => (channelFactory as (...a: unknown[]) => unknown)(...args),
    removeChannel: (...args: unknown[]) => (removeChannel as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock("../auth/useUser", () => ({
  useUser: () => userState,
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => profileState,
  useGetProfile: () => ({ data: { active_workspace_id: profileState.workspaceId } }),
}));

function wrapper(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WorkspaceRealtimeProvider>{children}</WorkspaceRealtimeProvider>
      </QueryClientProvider>
    );
  };
}

describe("WorkspaceRealtimeProvider", () => {
  beforeEach(() => {
    profileState.workspaceId = "ws-1";
    userState.user = { id: "user-1" };
    channelState.handlers = [];
    channelState.subscribeCb = null;
    channelState.channel = null;
    channelFactory.mockClear();
    removeChannel.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes with workspace_id filter for each phase-1 table and cleans up", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, unmount } = renderHook(() => useWorkspaceRealtime(), { wrapper: wrapper(client) });

    await waitFor(() => expect(channelFactory).toHaveBeenCalledWith("ws:ws-1"));
    expect(channelState.handlers).toHaveLength(REALTIME_WORKSPACE_TABLES.length);
    for (const table of REALTIME_WORKSPACE_TABLES) {
      expect(channelState.handlers.some((h) => h.table === table && h.filter === "workspace_id=eq.ws-1")).toBe(
        true,
      );
    }

    act(() => {
      channelState.subscribeCb?.("SUBSCRIBED");
    });
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));

    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });

  it("resubscribes when workspace switches", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender, unmount } = render(<div data-testid="shell" />, { wrapper: wrapper(client) });

    await waitFor(() => expect(channelFactory).toHaveBeenCalledWith("ws:ws-1"));
    channelFactory.mockClear();
    removeChannel.mockClear();

    profileState.workspaceId = "ws-2";
    rerender(<div data-testid="shell" />);

    await waitFor(() => expect(removeChannel).toHaveBeenCalled());
    await waitFor(() => expect(channelFactory).toHaveBeenCalledWith("ws:ws-2"));
    unmount();
  });

  it("refetches hot lists only on RE-subscribe, not on the first subscribe", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<div />, { wrapper: wrapper(client) });

    await waitFor(() => expect(channelState.handlers.length).toBeGreaterThan(0));
    act(() => {
      channelState.subscribeCb?.("SUBSCRIBED");
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      channelState.subscribeCb?.("CHANNEL_ERROR");
      channelState.subscribeCb?.("SUBSCRIBED");
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("debounces invalidation bursts across tables", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<div />, { wrapper: wrapper(client) });

    await waitFor(() => expect(channelState.handlers.length).toBeGreaterThan(0));
    act(() => {
      channelState.subscribeCb?.("SUBSCRIBED");
    });
    invalidate.mockClear();

    const ordersHandler = channelState.handlers.find((h) => h.table === "orders")!;
    const paymentsHandler = channelState.handlers.find((h) => h.table === "payments")!;
    act(() => {
      ordersHandler.cb({ table: "orders" });
      paymentsHandler.cb({ table: "payments" });
    });

    expect(invalidate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(REALTIME_INVALIDATE_DEBOUNCE_MS + 20);
    });

    expect(invalidate).toHaveBeenCalled();
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('"orders"'))).toBe(true);
    expect(keys.some((k) => k.includes('"payments"'))).toBe(true);
  });

  it("toggles hot-list poll when channel is not SUBSCRIBED", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRealtimeHotQueryOptions(), { wrapper: wrapper(client) });

    await waitFor(() => expect(channelState.subscribeCb).toBeTruthy());
    expect(result.current.refetchOnWindowFocus).toBe(true);
    expect(result.current.refetchOnReconnect).toBe(true);
    expect(result.current.refetchInterval).toBe(60_000);

    act(() => {
      channelState.subscribeCb?.("SUBSCRIBED");
    });
    await waitFor(() => expect(result.current.refetchInterval).toBe(false));

    act(() => {
      channelState.subscribeCb?.("CHANNEL_ERROR");
    });
    await waitFor(() => expect(result.current.refetchInterval).toBe(60_000));
  });

  it("does not subscribe without a user or workspace", async () => {
    profileState.workspaceId = undefined;
    userState.user = null;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<div />, { wrapper: wrapper(client) });
    expect(channelFactory).not.toHaveBeenCalled();
  });
});
