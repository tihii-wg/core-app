import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../lib/types";
import { stubLocalStorage } from "../tests/memoryStorage";
import { renderWithQuery } from "../tests/renderQuery";
import Dashboard from "./Dashboard";

const openOrder = vi.hoisted(() => vi.fn());

const sampleOrder: Order = {
  id: "o-1",
  clientId: "c1",
  clientName: "Ada Lovelace",
  clientPhone: "+37361111111",
  orderNumber: "ORD-100",
  device: "BMW X5",
  vin: "",
  carNumber: "ABC123",
  clientType: "individual",
  service: "Oil change",
  services: [],
  description: "",
  status: "in-progress",
  assignedEmployeeId: "emp-1",
  assignedEmployeeName: "Ada Tech",
  deadline: "2026-11-10",
  totalPrice: 120,
  isPaid: false,
  paymentStatus: "unpaid",
  createdById: "user-1",
  createdByName: "Olga Owner",
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01T10:00:00Z",
};

const financialState = vi.hoisted(() => ({
  awaitingOrders: [] as Array<{ order: Order; remaining: number }>,
  standaloneInvoiceCount: 0,
  unpaidOrders: 0,
  outstandingAmount: 0,
  hasOrders: true,
  isLoading: false,
  isError: false,
}));

vi.mock("../features/dashboard/useDashboardFinancials", () => ({
  useDashboardFinancials: () => ({
    revenueToday: 0,
    paidOrdersToday: 0,
    revenueChangeVsYesterday: null,
    outstandingAmount: financialState.outstandingAmount,
    unpaidOrders: financialState.unpaidOrders,
    hasOrders: financialState.hasOrders,
    awaitingPayment: {
      orders: financialState.awaitingOrders,
      standaloneInvoiceCount: financialState.standaloneInvoiceCount,
      totalCount: financialState.awaitingOrders.length + financialState.standaloneInvoiceCount,
    },
    payments: [],
    isLoading: financialState.isLoading,
    isError: financialState.isError,
  }),
}));

vi.mock("../features/workspaces/useWorkspaceSubscription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/workspaces/useWorkspaceSubscription")>();
  return {
    ...actual,
    useWorkspaceSubscription: () => ({
      canWrite: true,
      status: "active",
      expiresAt: null,
      isLoading: false,
      isEntitlementPending: false,
      isEntitlementResolved: true,
      error: null,
      refetch: vi.fn(),
      workspaceId: "ws-1",
    }),
    useGuardSubscriptionWrite: () => () => true,
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: () => ({ locale: "en", workspaceId: "ws-1" }),
    Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  };
});

vi.mock("../lib/appContext", () => ({
  useApp: () => ({ setCurrentModule: vi.fn() }),
}));

vi.mock("../features/profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
  useGetProfile: () => ({ data: { id: "user-1" }, isLoading: false }),
}));

vi.mock("../features/workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: { currency: "MDL", ownerId: "user-1", requireTaxInvoiceNumber: false },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../features/workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../features/orders/useOrderDetails", () => ({
  useOrderDetails: () => ({
    selectedOrder: null,
    detailPanelOpen: false,
    setDetailPanelOpen: vi.fn(),
    openOrder,
    changeStatus: vi.fn(),
    syncOrder: vi.fn(),
    clearOrder: vi.fn(),
    isStatusUpdating: false,
    requireTaxInvoiceNumber: false,
    isWorkspaceOwner: true,
    onOrderUpdated: vi.fn(),
    panelProps: {
      selectedOrder: null,
      detailPanelOpen: false,
      setDetailPanelOpen: vi.fn(),
    },
  }),
}));

vi.mock("../features/clients/useOpenClientDetails", () => ({
  useOpenClientDetails: () => ({
    selectedClient: null,
    detailPanelOpen: false,
    setDetailPanelOpen: vi.fn(),
    openClient: vi.fn(),
    onClientUpdated: vi.fn(),
    onClientDeleted: vi.fn(),
  }),
}));

vi.mock("../features/clients/ClientDetailsHost", () => ({ ClientDetailsHost: () => null }));
vi.mock("../features/orders/EditOrderDialog", () => ({ EditOrderDialog: () => null }));
vi.mock("../features/inventory/useGetInventoryItems", () => ({
  useGetInventoryItems: () => ({ items: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../features/workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
  }),
}));
vi.mock("../features/industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy, industryShellCopy } = await import("../features/industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      // OrderCard reads industrySlug/profile to decide which asset lines (plate) to show.
      return {
        workflow,
        copy: industryOrderCopy(workflow),
        shell: industryShellCopy(workflow),
        industrySlug: "auto_repair",
        profile: null,
      };
    },
  };
});
vi.mock("../features/dashboard/DashboardDeadlinePanels", () => ({ DashboardDeadlinePanels: () => null }));
vi.mock("../features/dashboard/DashboardQuickActions", () => ({ DashboardQuickActions: () => null }));
vi.mock("../features/orders/CreateOrderDialog", () => ({ CreateOrderDialog: () => null }));
vi.mock("../features/clients/AddClientDialog", () => ({ AddClientDialog: () => null }));
vi.mock("../features/inventory/AddInventoryItemDialog", () => ({ AddInventoryItemDialog: () => null }));
vi.mock("../features/inventory/EditInventoryItemDialog", () => ({ EditInventoryItemDialog: () => null }));
vi.mock("../features/orders/OrderDetailPanel", () => ({ default: () => null }));
vi.mock("../features/orders/useOrdersWarrantyIndicators", () => ({
  useOrdersWarrantyIndicators: () => ({ byOrderId: new Map() }),
}));
vi.mock("../features/finance/usePayments", () => ({
  useGetPayments: () => ({ payments: [], isLoading: false, error: null }),
}));
vi.mock("../features/invoices/useGetInvoices", () => ({
  useGetInvoices: () => ({ invoices: [], isLoading: false, error: null, isUnavailable: false }),
}));
vi.mock("../features/invoices/useCreateInvoice", () => ({
  useCreateInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

const ordersState = vi.hoisted(() => ({
  orders: [] as Order[],
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey?: unknown[] }) => {
      const key = Array.isArray(options.queryKey) ? String(options.queryKey[0]) : "";
      if (key === "orders") {
        return {
          data: ordersState.orders,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
          isRefetching: false,
        };
      }
      if (key === "order_events") {
        return {
          data: { orderIds: ordersState.orders.map((order) => order.id), isUnavailable: false },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
          isRefetching: false,
        };
      }
      return {
        data: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        isRefetching: false,
      };
    },
  };
});

function stubDesktopViewport() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
}

function stubMobileViewport() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
}

describe("Dashboard shared orders list", () => {
  beforeEach(() => {
    stubLocalStorage();
    stubDesktopViewport();
    openOrder.mockReset();
    ordersState.orders = [sampleOrder];
    financialState.awaitingOrders = [{ order: sampleOrder, remaining: 75 }];
    financialState.standaloneInvoiceCount = 0;
    financialState.unpaidOrders = 1;
    financialState.outstandingAmount = 75;
    financialState.hasOrders = true;
    financialState.isLoading = false;
    financialState.isError = false;
  });

  it("renders the same order column headers as the Orders page", () => {
    renderWithQuery(<Dashboard />);

    expect(screen.getByRole("columnheader", { name: "Order #" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Client Type" })).not.toBeInTheDocument();
    expect(screen.getByTestId("order-client-type")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Vehicle/Service" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Payment" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Created by" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Assigned" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Deadline" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });

  it("exposes the ⋯ actions menu on dashboard rows", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Dashboard />);

    await user.click(screen.getByRole("button", { name: /Actions for order ORD-100/i }));
    expect(await screen.findByRole("menuitem", { name: "View details" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
  });

  it("renders OrderCard on a phone viewport", () => {
    stubMobileViewport();
    renderWithQuery(<Dashboard />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Actions for order ORD-100/i })).toBeInTheDocument();
    expect(screen.getByText("BMW X5")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });

  it("shows the To pay column in the awaiting-payment desktop view", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Dashboard />);

    await user.click(screen.getByRole("button", { name: /Outstanding Payments/i }));
    expect(screen.getByRole("columnheader", { name: "To pay" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("MDL 75.00")).toBeInTheDocument();
  });

  it("shows the To pay line on mobile OrderCards in the awaiting-payment view", async () => {
    stubMobileViewport();
    const user = userEvent.setup();
    renderWithQuery(<Dashboard />);

    await user.click(screen.getByRole("button", { name: /Outstanding Payments/i }));
    expect(screen.getByText(/To pay:\s*MDL 75\.00/i)).toBeInTheDocument();
  });
});
