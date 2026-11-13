import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const openOrder = vi.fn();
const getOrder = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

vi.mock("./useOrderDetails", () => ({
  useOrderDetails: () => ({
    openOrder,
    clearOrder: vi.fn(),
    syncOrder: vi.fn(),
    isWorkspaceOwner: true,
    requireTaxInvoiceNumber: false,
    panelProps: {
      selectedOrder: null,
      detailPanelOpen: false,
      setDetailPanelOpen: vi.fn(),
      onOrderUpdated: vi.fn(),
      onStatusChange: vi.fn(),
      isStatusUpdating: false,
    },
  }),
}));

vi.mock("./useGetOrders", async () => {
  const actual = await vi.importActual<typeof import("./useGetOrders")>("./useGetOrders");
  return {
    ...actual,
    useOrdersPage: () => ({
      data: { orders: [], total: 0, page: 1, pageSize: 25 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
    useOrdersAwaitingPayment: () => ({ data: { count: 0, amount: 0 }, isLoading: false }),
    findCachedOrder: () => null,
  };
});

vi.mock("../../services/apiOrders", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiOrders")>("../../services/apiOrders");
  return {
    ...actual,
    getOrder: (...args: unknown[]) => getOrder(...args),
  };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-test-12345678" }),
}));

vi.mock("../industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({
    workflow: { slug: "auto_service", copyPack: "auto" },
    copy: { deviceServiceColumn: "Vehicle" },
    profile: { orderFieldBlocks: {} },
  }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => String(n) }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ readOnly: false }),
}));

vi.mock("../invoices/useGetInvoices", () => ({
  useGetInvoices: () => ({ invoices: [], isLoading: false, error: null }),
}));

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({ payments: [], isLoading: false, error: null }),
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ data: [] }),
}));

vi.mock("../statuses/useGetStatusDefinitions", () => ({
  useGetStatusDefinitions: () => ({ data: [] }),
}));

vi.mock("./useOrderFieldConfig", () => ({
  useOrderFieldConfig: () => ({ fields: [] }),
}));

vi.mock("../clients/useOpenClientDetails", () => ({
  useOpenClientDetails: () => ({ openClient: vi.fn() }),
}));

vi.mock("../clients/ClientDetailsHost", () => ({
  ClientDetailsHost: () => null,
}));

vi.mock("./OrderDetailPanel", () => ({ default: () => null }));
vi.mock("./CreateOrderDialog", () => ({ CreateOrderDialog: () => null }));
vi.mock("./EditOrderDialog", () => ({ EditOrderDialog: () => null }));
vi.mock("./OrdersBoard", () => ({ OrdersBoard: () => null }));
vi.mock("./OrdersCalendar", () => ({ OrdersCalendar: () => null }));
vi.mock("./OrdersListView", () => ({ OrdersListView: () => <div>list</div> }));

import { Orders } from "./Orders";

describe("Orders ?open= deep link", () => {
  beforeEach(() => {
    openOrder.mockReset();
    getOrder.mockReset();
    getOrder.mockResolvedValue({
      id: "ord-deep",
      orderNumber: "ORD-1",
      status: "new",
      kind: "order",
    });
  });

  it("opens the order sheet from ?open= and clears the param", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/en/ws-test-12345678/orders?open=ord-deep"]}>
          <Routes>
            <Route path="/:locale/:workspaceId/orders" element={<Orders />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(openOrder).toHaveBeenCalled());
    expect(getOrder).toHaveBeenCalledWith("ord-deep", "ws-test-12345678");
  });
});
