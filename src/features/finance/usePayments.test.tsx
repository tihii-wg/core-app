import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paymentsQueryKey, useGetPayments, useRecordPayment } from "./usePayments";

const mocks = vi.hoisted(() => ({
  getPayments: vi.fn(),
  recordPayment: vi.fn(),
  guardWrite: vi.fn(),
  workspaceId: "ws-a" as string | undefined,
}));

vi.mock("../../services/apiPayments", () => ({
  getPayments: (...args: unknown[]) => mocks.getPayments(...args),
  recordPayment: (...args: unknown[]) => mocks.recordPayment(...args),
  recordRefund: vi.fn(),
  PaymentsUnavailableError: class PaymentsUnavailableError extends Error {
    constructor() {
      super("unavailable");
      this.name = "PaymentsUnavailableError";
    }
  },
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: mocks.workspaceId }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => mocks.guardWrite,
}));

vi.mock("react-hot-toast", () => ({
  default: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePayments", () => {
  beforeEach(() => {
    mocks.workspaceId = "ws-a";
    mocks.getPayments.mockReset();
    mocks.recordPayment.mockReset();
    mocks.guardWrite.mockReset();
    mocks.getPayments.mockResolvedValue([]);
    mocks.recordPayment.mockResolvedValue({ id: "p1" });
  });

  it("scopes the query key to the active workspace", () => {
    expect(paymentsQueryKey("ws-a", { orderId: "o1" })).toEqual(["payments", "ws-a", { orderId: "o1" }]);
    expect(paymentsQueryKey("ws-b")).not.toEqual(paymentsQueryKey("ws-a"));
  });

  it("loads payments for the active workspace only", async () => {
    const { result } = renderHook(() => useGetPayments({ orderId: "o1" }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.getPayments).toHaveBeenCalledWith("ws-a", { orderId: "o1" });
  });

  it("does not fetch when there is no workspace", async () => {
    mocks.workspaceId = undefined;
    const { result } = renderHook(() => useGetPayments(), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(mocks.getPayments).not.toHaveBeenCalled();
  });

  it("guards subscription writes before recording a payment", async () => {
    const { result } = renderHook(() => useRecordPayment(), { wrapper: wrapper() });
    result.current.mutate({
      orderId: "o1",
      amount: 10,
      currencyCode: "MDL",
      paymentMethod: "cash",
      paidAt: new Date().toISOString(),
    });
    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalled());
    expect(mocks.guardWrite).toHaveBeenCalled();
  });
});
