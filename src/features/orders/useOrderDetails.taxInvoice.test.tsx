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
});
