import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { useOrderDetails } from "./useOrderDetails";

const statusHooks = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

const workspaceState = vi.hoisted(() => ({
  requireTaxInvoiceNumber: true,
}));

vi.mock("./useGetOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useGetOrders")>();
  return {
    ...actual,
    useUpdateOrderStatus: () => ({
      mutate: statusHooks.mutate,
      isPending: statusHooks.isPending,
    }),
  };
});

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: { requireTaxInvoiceNumber: workspaceState.requireTaxInvoiceNumber },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

const baseOrder: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Org SA",
  clientType: "organization",
  orderNumber: "ORD-1",
  device: "BMW",
  vin: "",
  carNumber: "",
  service: "Oil",
  services: [],
  description: "",
  status: "completed",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 10,
  isPaid: false,
  paymentStatus: "unpaid",
  taxInvoiceNumber: "",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

describe("useOrderDetails tax invoice persistence", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    statusHooks.mutate.mockReset();
    statusHooks.isPending = false;
    workspaceState.requireTaxInvoiceNumber = true;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  it("reopens a legal-entity order using the cached saved tax invoice number when the list row is still empty", () => {
    queryClient.setQueryData(["orders", "ws-1", "page", { page: 1 }], {
      orders: [{ ...baseOrder, taxInvoiceNumber: "FV-CACHED" }],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    });

    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      // Simulate clicking a stale list row (placeholderData) that still has an empty number.
      result.current.openOrder({ ...baseOrder, taxInvoiceNumber: "" });
    });

    expect(result.current.panelProps.selectedOrder?.taxInvoiceNumber).toBe("FV-CACHED");
    expect(result.current.panelProps.detailPanelOpen).toBe(true);
  });

  it("does not let syncOrder wipe a saved tax invoice number with an empty refetch payload", () => {
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.openOrder({ ...baseOrder, taxInvoiceNumber: "FV-KEEP" });
    });
    act(() => {
      result.current.syncOrder({ ...baseOrder, taxInvoiceNumber: "" });
    });

    expect(result.current.panelProps.selectedOrder?.taxInvoiceNumber).toBe("FV-KEEP");
  });

  it("still blocks paying a legal-entity order when neither the row nor the cache has a number", () => {
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.changeStatus({ ...baseOrder, taxInvoiceNumber: "" }, "paid");
    });

    expect(statusHooks.mutate).not.toHaveBeenCalled();
    expect(result.current.panelProps.detailPanelOpen).toBe(true);
  });

  it("blocks paying a legal-entity order when the tax invoice number is whitespace-only", () => {
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.changeStatus({ ...baseOrder, taxInvoiceNumber: "   " }, "paid");
    });

    expect(statusHooks.mutate).not.toHaveBeenCalled();
    expect(result.current.panelProps.detailPanelOpen).toBe(true);
  });

  it("blocks payment when a stale list row says individual but the cache knows the customer is a legal entity", () => {
    queryClient.setQueryData(["orders", "ws-1"], [
      { ...baseOrder, clientType: "organization", taxInvoiceNumber: "" },
    ]);
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      // Stale actions-menu payload incorrectly typed as individual.
      result.current.changeStatus({ ...baseOrder, clientType: "individual", taxInvoiceNumber: "" }, "paid");
    });

    expect(statusHooks.mutate).not.toHaveBeenCalled();
    expect(result.current.panelProps.selectedOrder?.clientType).toBe("organization");
  });

  it("allows paying once a saved number is in the cache even if the list row is still empty", () => {
    queryClient.setQueryData(["orders", "ws-1", "page", { page: 1 }], {
      orders: [{ ...baseOrder, taxInvoiceNumber: "FV-SAVED" }],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    });
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.changeStatus({ ...baseOrder, taxInvoiceNumber: "" }, "paid");
    });

    expect(statusHooks.mutate).toHaveBeenCalledExactlyOnceWith(
      { orderId: "order-1", status: "paid" },
      expect.any(Object),
    );
  });

  it("allows paying an individual order without a tax invoice number", () => {
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.changeStatus({ ...baseOrder, clientType: "individual", taxInvoiceNumber: "" }, "paid");
    });

    expect(statusHooks.mutate).toHaveBeenCalledExactlyOnceWith(
      { orderId: "order-1", status: "paid" },
      expect.any(Object),
    );
  });

  it("does not block payment when the workspace requirement is disabled", () => {
    workspaceState.requireTaxInvoiceNumber = false;
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.changeStatus({ ...baseOrder, taxInvoiceNumber: "" }, "paid");
    });

    expect(statusHooks.mutate).toHaveBeenCalledExactlyOnceWith(
      { orderId: "order-1", status: "paid" },
      expect.any(Object),
    );
  });

  it("rejects changing away from Paid even when the list row is stale as unpaid", () => {
    queryClient.setQueryData(["orders", "ws-1"], [{ ...baseOrder, status: "paid", isPaid: true }]);
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.changeStatus({ ...baseOrder, status: "completed", taxInvoiceNumber: "FV-1" }, "in-progress");
    });

    expect(statusHooks.mutate).not.toHaveBeenCalled();
  });

  it("rejects changing a Paid order to cancelled from the UI gate", () => {
    const { result } = renderHook(() => useOrderDetails(), { wrapper });

    act(() => {
      result.current.changeStatus({ ...baseOrder, status: "paid", isPaid: true, taxInvoiceNumber: "FV-1" }, "cancelled");
    });

    expect(statusHooks.mutate).not.toHaveBeenCalled();
  });
});
