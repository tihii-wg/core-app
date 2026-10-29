import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navCountQueryKey } from "../../services/apiNavCounts";
import { useNavCounts } from "./useNavCounts";

const mocks = vi.hoisted(() => ({
  workspaceId: "ws-1" as string | undefined,
  countWorkspaceNavModule: vi.fn(),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: mocks.workspaceId, isLoading: false, error: null }),
}));

vi.mock("../../services/apiNavCounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiNavCounts")>();
  return {
    ...actual,
    countWorkspaceNavModule: mocks.countWorkspaceNavModule,
  };
});

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useNavCounts", () => {
  beforeEach(() => {
    mocks.workspaceId = "ws-1";
    mocks.countWorkspaceNavModule.mockReset();
    mocks.countWorkspaceNavModule.mockImplementation(async (module: string) => {
      const values: Record<string, number> = {
        orders: 12,
        clients: 8,
        services: 4,
        inventory: 20,
        employees: 3,
      };
      return values[module] ?? 0;
    });
  });

  it("loads complete workspace totals for all five navigation modules", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.counts.orders).toBe(12));
    expect(result.current.counts).toEqual({
      orders: 12,
      clients: 8,
      services: 4,
      inventory: 20,
      employees: 3,
    });
    expect(mocks.countWorkspaceNavModule).toHaveBeenCalledTimes(5);
  });

  it("omits counts while loading so the UI does not flash zero", () => {
    mocks.countWorkspaceNavModule.mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper(queryClient) });

    expect(result.current.counts).toEqual({});
    expect(result.current.isLoading).toBe(true);
  });

  it("keeps successful counts when one module fails", async () => {
    mocks.countWorkspaceNavModule.mockImplementation(async (module: string) => {
      if (module === "inventory") throw new Error("inventory down");
      return 2;
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.counts.orders).toBe(2));
    expect(result.current.counts.inventory).toBeUndefined();
    expect(result.current.hasError).toBe(true);
  });

  it("does not fetch without an active workspace", () => {
    mocks.workspaceId = undefined;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper(queryClient) });

    expect(result.current.counts).toEqual({});
    expect(mocks.countWorkspaceNavModule).not.toHaveBeenCalled();
  });

  it("refetches when entity queries are invalidated after create/delete", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.counts.orders).toBe(12));
    mocks.countWorkspaceNavModule.mockImplementation(async (module: string) => (module === "orders" ? 13 : 1));

    await queryClient.invalidateQueries({ queryKey: ["orders", "ws-1"] });

    await waitFor(() => expect(result.current.counts.orders).toBe(13));
    expect(queryClient.getQueryData(navCountQueryKey("orders", "ws-1"))).toBe(13);
  });

  it("loads a fresh set of counts when the active workspace changes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(() => useNavCounts(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.counts.clients).toBe(8));

    mocks.workspaceId = "ws-2";
    mocks.countWorkspaceNavModule.mockImplementation(async () => 99);
    rerender();

    await waitFor(() => expect(result.current.counts.clients).toBe(99));
    expect(mocks.countWorkspaceNavModule.mock.calls.some((call) => call[1] === "ws-2")).toBe(true);
  });
});
