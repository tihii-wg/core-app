import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateOrder = vi.hoisted(() => vi.fn());
const closeOrder = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiOrders")>();
  return {
    ...actual,
    updateOrder,
    closeOrder,
  };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { useUpdateOrder } from "./useUpdateOrder";
import { useCloseOrder } from "./useCloseOrder";

describe("warranty cache invalidation", () => {
  let client: QueryClient;

  beforeEach(() => {
    updateOrder.mockReset();
    closeOrder.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("invalidates warranty indicator and records keys after updateOrder", async () => {
    updateOrder.mockResolvedValue({ id: "order-1" });
    const indicators = vi.fn();
    const records = vi.fn();
    client.setQueryDefaults(["orders-warranty-indicators", "ws-1"], {});
    client.setQueryDefaults(["warranty-records", "ws-1"], {});
    const unsub1 = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.query.queryHash.includes("orders-warranty-indicators")) {
        indicators();
      }
    });
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useUpdateOrder(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        orderId: "order-1",
        device: "Phone",
        carNumber: "",
        vin: "",
        description: "",
        assignedEmployeeId: "",
        deadline: "",
      });
    });

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["orders-warranty-indicators", "ws-1"] });
      expect(spy).toHaveBeenCalledWith({ queryKey: ["warranty-records", "ws-1"] });
    });

    unsub1();
    void records;
    void indicators;
  });

  it("invalidates warranty-records after closeOrder", async () => {
    closeOrder.mockResolvedValue({
      status: "closed",
      closed_at: "2026-11-06T00:00:00.000Z",
      customStatusId: null,
      customStatus: null,
    });
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useCloseOrder(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("order-1");
    });

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["warranty-records", "ws-1"] });
      expect(spy).toHaveBeenCalledWith({ queryKey: ["orders-warranty-indicators", "ws-1"] });
    });
  });
});
