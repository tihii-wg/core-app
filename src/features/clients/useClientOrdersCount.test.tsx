import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientOrdersCountQueryKey, useClientOrdersCount } from "./useClientOrdersCount";

const countClientOrders = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiOrders")>();
  return {
    ...actual,
    countClientOrders,
  };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useClientOrdersCount", () => {
  beforeEach(() => {
    countClientOrders.mockReset();
    countClientOrders.mockResolvedValue(4);
  });

  it("loads the client-scoped count for the active workspace", async () => {
    const { result } = renderHook(() => useClientOrdersCount("client-1"), { wrapper });

    await waitFor(() => expect(result.current.count).toBe(4));
    expect(countClientOrders).toHaveBeenCalledExactlyOnceWith("ws-1", "client-1");
  });

  it("does not query when disabled or without a client", async () => {
    const { result: noClient } = renderHook(() => useClientOrdersCount(null), { wrapper });
    expect(noClient.current.count).toBeNull();

    const { result: disabled } = renderHook(() => useClientOrdersCount("client-1", { enabled: false }), {
      wrapper,
    });
    expect(disabled.current.count).toBeNull();
    expect(countClientOrders).not.toHaveBeenCalled();
  });

  it("uses a query key under orders so invalidation refreshes the total", () => {
    expect(clientOrdersCountQueryKey("ws-1", "client-1")).toEqual([
      "orders",
      "ws-1",
      "client-count",
      "client-1",
    ]);
  });
});
