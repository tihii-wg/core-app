import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuardSubscriptionWrite, useWorkspaceSubscription } from "./useWorkspaceSubscription";

const workspaceState = vi.hoisted(() => ({
  workspaceId: "ws-a" as string | undefined,
  profileLoading: false,
  query: {
    isPending: false,
    isFetching: false,
    isFetched: true,
    isError: false,
    error: null as Error | null,
  },
  byId: {
    "ws-a": {
      id: "ws-a",
      subscriptionStatus: "active" as string | null,
      subscriptionStartedAt: "2026-01-01T00:00:00.000Z",
      subscriptionExpiresAt: null as string | null,
      subscriptionUpdatedAt: "2026-01-01T00:00:00.000Z",
    },
    "ws-b": {
      id: "ws-b",
      subscriptionStatus: "expired" as string | null,
      subscriptionStartedAt: "2025-01-01T00:00:00.000Z",
      subscriptionExpiresAt: "2025-06-01T00:00:00.000Z",
      subscriptionUpdatedAt: "2025-06-01T00:00:00.000Z",
    },
  } as Record<
    string,
    {
      id: string;
      subscriptionStatus: string | null;
      subscriptionStartedAt: string | null;
      subscriptionExpiresAt: string | null;
      subscriptionUpdatedAt: string | null;
    }
  >,
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({
    workspaceId: workspaceState.workspaceId,
    isLoading: workspaceState.profileLoading,
  }),
}));

vi.mock("./useGetWorkspace", () => ({
  useGetWorkspace: (workspaceId?: string) => {
    const row = workspaceId ? workspaceState.byId[workspaceId] : undefined;
    const data =
      workspaceState.query.isPending || workspaceState.query.isError || !workspaceId ? undefined : (row ?? null);
    return {
      data,
      isPending: workspaceState.query.isPending || !workspaceId,
      isFetching: workspaceState.query.isFetching,
      isFetched: workspaceState.query.isFetched,
      isError: workspaceState.query.isError,
      error: workspaceState.query.error,
      refetch: vi.fn(),
    };
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useWorkspaceSubscription", () => {
  beforeEach(() => {
    workspaceState.workspaceId = "ws-a";
    workspaceState.profileLoading = false;
    workspaceState.query = {
      isPending: false,
      isFetching: false,
      isFetched: true,
      isError: false,
      error: null,
    };
  });

  it("reports write entitlement for the active workspace", async () => {
    const { result } = renderHook(() => useWorkspaceSubscription(), { wrapper });
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.workspaceId).toBe("ws-a");
    expect(result.current.status).toBe("active");
    expect(result.current.isEntitlementPending).toBe(false);
  });

  it("stays pending without flashing write denial while the profile workspace id loads", () => {
    workspaceState.workspaceId = undefined;
    workspaceState.profileLoading = true;
    workspaceState.query.isPending = true;

    const { result } = renderHook(() => useWorkspaceSubscription(), { wrapper });

    expect(result.current.isEntitlementPending).toBe(true);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.canWrite).toBe(false);
    expect(result.current.status).toBeNull();
  });

  it("stays pending while the workspace subscription query has not resolved", () => {
    workspaceState.query.isPending = true;
    workspaceState.query.isFetched = false;

    const { result } = renderHook(() => useWorkspaceSubscription(), { wrapper });

    expect(result.current.isEntitlementPending).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it("denies writes for an expired subscription once resolved", async () => {
    workspaceState.workspaceId = "ws-b";
    const { result } = renderHook(() => useWorkspaceSubscription(), { wrapper });
    await waitFor(() => expect(result.current.isEntitlementPending).toBe(false));
    expect(result.current.canWrite).toBe(false);
    expect(result.current.status).toBe("expired");
  });

  it("exposes query errors without treating them as an expired subscription", () => {
    workspaceState.query.isPending = false;
    workspaceState.query.isError = true;
    workspaceState.query.error = new Error("network down");

    const { result } = renderHook(() => useWorkspaceSubscription(), { wrapper });

    expect(result.current.isEntitlementPending).toBe(false);
    expect(result.current.canWrite).toBe(false);
    expect(result.current.error).toEqual(expect.objectContaining({ message: "network down" }));
    expect(result.current.status).toBeNull();
  });

  it("does not reuse subscription state after switching workspaces", async () => {
    const { result, rerender } = renderHook(() => useWorkspaceSubscription(), { wrapper });
    await waitFor(() => expect(result.current.canWrite).toBe(true));

    workspaceState.workspaceId = "ws-b";
    workspaceState.query.isPending = true;
    rerender();

    expect(result.current.workspaceId).toBe("ws-b");
    expect(result.current.isEntitlementPending).toBe(true);
    expect(result.current.canWrite).toBe(false);
    expect(result.current.status).toBeNull();

    workspaceState.query.isPending = false;
    rerender();

    await waitFor(() => {
      expect(result.current.isEntitlementPending).toBe(false);
      expect(result.current.canWrite).toBe(false);
      expect(result.current.status).toBe("expired");
    });
  });

  it("blocks mutations while entitlement is still pending", () => {
    workspaceState.workspaceId = "ws-a";
    workspaceState.query.isPending = true;
    workspaceState.query.isFetched = false;

    const { result } = renderHook(() => useGuardSubscriptionWrite(), { wrapper });
    expect(() => result.current()).toThrow(/inactive or expired|subscription/i);
  });
});
