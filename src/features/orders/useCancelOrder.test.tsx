import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { useCancelOrder } from "./useCloseOrder";

const cancelOrderMock = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", () => ({
  cancelOrder: (...args: unknown[]) => cancelOrderMock(...args),
  closeOrder: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: toastSuccess, error: toastError, loading: vi.fn() },
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => vi.fn(),
}));

function order(partial: Partial<Order> & { id: string }): Order {
  return {
    clientId: "c1",
    clientName: "Client",
    orderNumber: partial.id,
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: "in-progress",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "",
    updatedAt: "",
    customStatusId: "def-progress",
    customStatus: { name: "In Progress", color: "#0f0" },
    ...partial,
  };
}

describe("useCancelOrder", () => {
  beforeEach(() => {
    cancelOrderMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("patches cached orders to cancelled and toasts only after success", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(["orders", "ws-1"], [order({ id: "order-1" })]);
    cancelOrderMock.mockResolvedValue({
      status: "cancelled",
      customStatusId: null,
      customStatus: null,
      idempotent: false,
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    result.current.mutate("order-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<Order[]>(["orders", "ws-1"]);
    expect(cached?.[0]?.status).toBe("cancelled");
    expect(cached?.[0]?.customStatusId).toBeNull();
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not toast success or patch cache when cancel fails", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(["orders", "ws-1"], [order({ id: "order-1" })]);
    cancelOrderMock.mockRejectedValue(new Error("forbidden"));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    result.current.mutate("order-1");
    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<Order[]>(["orders", "ws-1"]);
    expect(cached?.[0]?.status).toBe("in-progress");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});
