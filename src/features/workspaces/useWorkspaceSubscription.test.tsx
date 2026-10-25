import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSubscription } from "./useWorkspaceSubscription";

const workspaceState = vi.hoisted(() => ({
  workspaceId: "ws-a" as string | undefined,
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
  },
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: workspaceState.workspaceId }),
}));

vi.mock("./useGetWorkspace", () => ({
  useGetWorkspace: (workspaceId?: string) => {
    const data = workspaceId ? workspaceState.byId[workspaceId as keyof typeof workspaceState.byId] : undefined;
    return {
      data: data ?? null,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
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
  });

  it("reports write entitlement for the active workspace", async () => {
    const { result } = renderHook(() => useWorkspaceSubscription(), { wrapper });
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.workspaceId).toBe("ws-a");
    expect(result.current.status).toBe("active");
  });

  it("does not reuse subscription state after switching workspaces", async () => {
    const { result, rerender } = renderHook(() => useWorkspaceSubscription(), { wrapper });
    await waitFor(() => expect(result.current.canWrite).toBe(true));

    workspaceState.workspaceId = "ws-b";
    rerender();

    await waitFor(() => {
      expect(result.current.workspaceId).toBe("ws-b");
      expect(result.current.canWrite).toBe(false);
      expect(result.current.status).toBe("expired");
    });
  });
});
