import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { useCancelOrder } from "./useCloseOrder";

const cancelWithVoidMock = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastPlain = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", () => ({
  cancelOrderWithPaymentVoid: (...args: unknown[]) => cancelWithVoidMock(...args),
  closeOrder: vi.fn(),
}));

vi.mock("react-hot-toast", () => {
  const toast = Object.assign(toastPlain, {
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(),
  });
  return { default: toast };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { currency: "MDL" } }),
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
    cancelWithVoidMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastPlain.mockReset();
  });

  it("patches cached orders to cancelled and toasts only after success", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(["orders", "ws-1"], [order({ id: "order-1" })]);
    cancelWithVoidMock.mockResolvedValue({
      status: "cancelled",
      customStatusId: null,
      customStatus: null,
      idempotent: false,
      voidedCount: 0,
      voidedTotal: 0,
      skipped: [],
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    result.current.mutate("order-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(cancelWithVoidMock).toHaveBeenCalledWith("order-1", "ws-1", {
      voidPayments: false,
      reason: null,
    });
    const cached = queryClient.getQueryData<Order[]>(["orders", "ws-1"]);
    expect(cached?.[0]?.status).toBe("cancelled");
    expect(cached?.[0]?.customStatusId).toBeNull();
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts cancelledAndVoided and skipped refunds when payments were voided", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(["orders", "ws-1"], [order({ id: "order-1" })]);
    queryClient.setQueryData(["payments", "ws-1"], [{ id: "pay-1" }]);
    cancelWithVoidMock.mockResolvedValue({
      status: "cancelled",
      customStatusId: null,
      customStatus: null,
      idempotent: false,
      voidedCount: 2,
      voidedTotal: 150,
      skipped: [{ paymentId: "pay-3", amount: 10, reason: "has_refund" }],
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    result.current.mutate({ orderId: "order-1", voidPayments: true, reason: "Client refused" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(cancelWithVoidMock).toHaveBeenCalledWith("order-1", "ws-1", {
      voidPayments: true,
      reason: "Client refused",
    });
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/voided|аннулир|anulat/i));
    expect(toastPlain).toHaveBeenCalledWith(expect.stringMatching(/refund|возврат|ramburs/i), expect.any(Object));
  });

  it("does not toast success or patch cache when cancel fails", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(["orders", "ws-1"], [order({ id: "order-1" })]);
    cancelWithVoidMock.mockRejectedValue(new Error("forbidden"));

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
