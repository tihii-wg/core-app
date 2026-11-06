import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateAndPostSupplierReturn, useRecordSupplierReturnRefund } from "./useWarehouseOps";

const createAndPost = vi.hoisted(() => vi.fn());
const recordRefund = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiWarehouseOps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiWarehouseOps")>();
  return {
    ...actual,
    createAndPostSupplierReturn: (...args: unknown[]) => createAndPost(...args),
    recordSupplierReturnRefund: (...args: unknown[]) => recordRefund(...args),
  };
});

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: toastSuccess, error: toastError }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => () => undefined,
}));

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("supplier return refund mutations", () => {
  beforeEach(() => {
    createAndPost.mockReset();
    recordRefund.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("invalidates finance balances after recording a refund", async () => {
    recordRefund.mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRecordSupplierReturnRefund(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      result.current.mutate({
        returnId: "sr1",
        input: { accountId: "acc-1", amount: 20 },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["finance-accounts", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["payments", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["dashboard", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["warehouse-ops", "supplierReturn", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["supplier-returns", "ws-1"] });
  });

  it("toasts refundSkipped when combined post falls back", async () => {
    createAndPost.mockResolvedValue({ returnId: "sr1", refundSkipped: true });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useCreateAndPostSupplierReturn(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      result.current.mutate({
        warehouseId: "wh",
        reason: "Defect",
        lines: [{ inventoryItemId: "i1", itemName: "Pad", quantity: 1, unitCost: 10 }],
        refund: { accountId: "acc-1", amount: 10 },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastError).toHaveBeenCalled();
  });
});
