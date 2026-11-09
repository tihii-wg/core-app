import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../lib/types";
import { renderWithQuery } from "../tests/renderQuery";
import Dashboard from "./Dashboard";

const openOrder = vi.hoisted(() => vi.fn());

const unpaidOrder: Order = {
  id: "o-unpaid",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "ORD-100",
  device: "Unpaid car",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  description: "",
  status: "in-progress",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 120,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

const paidActiveOrder: Order = {
  ...unpaidOrder,
  id: "o-paid-active",
  orderNumber: "ORD-200",
  device: "Paid active car",
  totalPrice: 50,
  isPaid: true,
  paymentStatus: "paid",
  status: "in-progress",
  createdAt: "2026-11-02T10:00:00Z",
};

const closedRecentOrder: Order = {
  ...unpaidOrder,
  id: "o-closed",
  orderNumber: "ORD-300",
  device: "Closed car",
  totalPrice: 90,
  isPaid: true,
  paymentStatus: "paid",
  status: "completed",
  createdAt: "2026-11-03T10:00:00Z",
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

vi.mock("../features/clients/ClientDetailsHost", () => ({
  ClientDetailsHost: () => null,
}));

vi.mock("../features/orders/EditOrderDialog", () => ({
  EditOrderDialog: () => null,
}));

vi.mock("../features/invoices/useGetInvoices", () => ({
  useGetInvoices: () => ({ invoices: [], isLoading: false, error: null, isUnavailable: false }),
}));

vi.mock("../features/invoices/useCreateInvoice", () => ({
  useCreateInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

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
      return { workflow, copy: industryOrderCopy(workflow), shell: industryShellCopy(workflow) };
    },
  };
});

vi.mock("../features/dashboard/DashboardDeadlinePanels", () => ({
  DashboardDeadlinePanels: () => null,
}));

vi.mock("../features/dashboard/DashboardQuickActions", () => ({
  DashboardQuickActions: () => null,
}));

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

function setAwaitingFixture(options?: { empty?: boolean; withStandalone?: boolean }) {
  ordersState.orders = [unpaidOrder, paidActiveOrder, closedRecentOrder];
  if (options?.empty) {
    financialState.awaitingOrders = [];
    financialState.standaloneInvoiceCount = 0;
    financialState.unpaidOrders = 0;
    financialState.outstandingAmount = 0;
    return;
  }
  financialState.awaitingOrders = [{ order: unpaidOrder, remaining: 75 }];
  financialState.standaloneInvoiceCount = options?.withStandalone ? 2 : 0;
  financialState.unpaidOrders = financialState.awaitingOrders.length + financialState.standaloneInvoiceCount;
  financialState.outstandingAmount = 75;
}

describe("Dashboard awaiting payment card", () => {
  beforeEach(() => {
    openOrder.mockReset();
    financialState.isLoading = false;
    financialState.isError = false;
    financialState.hasOrders = true;
    setAwaitingFixture();
  });

  it("shows awaiting orders with a To pay column, then restores the previous recent list", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Recent Orders" })).toBeInTheDocument();
    expect(screen.getByText("Closed car")).toBeInTheDocument();
    expect(screen.getByText("Unpaid car")).toBeInTheDocument();

    const card = screen.getByRole("button", { name: /Outstanding Payments/i });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card).toBeEnabled();

    await user.click(card);

    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Awaiting payment" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "To pay" })).toBeInTheDocument();
    expect(screen.getByText("Unpaid car")).toBeInTheDocument();
    expect(screen.getByText("MDL 75.00")).toBeInTheDocument();
    expect(screen.queryByText("Closed car")).not.toBeInTheDocument();
    expect(screen.queryByText("Paid active car")).not.toBeInTheDocument();

    await user.click(card);

    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Recent Orders" })).toBeInTheDocument();
    expect(screen.getByText("Closed car")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "To pay" })).not.toBeInTheDocument();
  });

  it("restores the previous active list after toggling awaiting payment", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Dashboard />);

    await user.click(screen.getByRole("button", { name: /^Active Orders/ }));
    expect(screen.getByRole("heading", { name: "Active Orders" })).toBeInTheDocument();
    expect(screen.getByText("Paid active car")).toBeInTheDocument();
    expect(screen.queryByText("Closed car")).not.toBeInTheDocument();

    const card = screen.getByRole("button", { name: /Outstanding Payments/i });
    await user.click(card);
    expect(screen.getByRole("heading", { name: "Awaiting payment" })).toBeInTheDocument();
    expect(screen.getByText("Unpaid car")).toBeInTheDocument();
    expect(screen.queryByText("Paid active car")).not.toBeInTheDocument();

    await user.click(card);
    expect(screen.getByRole("heading", { name: "Active Orders" })).toBeInTheDocument();
    expect(screen.getByText("Paid active car")).toBeInTheDocument();
    expect(screen.queryByText("Closed car")).not.toBeInTheDocument();
  });

  it("disables the card when nothing is awaiting payment", () => {
    setAwaitingFixture({ empty: true });
    renderWithQuery(<Dashboard />);
    const card = screen.getByRole("button", { name: /Outstanding Payments/i });
    expect(card).toBeDisabled();
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a link for standalone unpaid invoices", async () => {
    const user = userEvent.setup();
    setAwaitingFixture({ withStandalone: true });
    renderWithQuery(<Dashboard />);

    await user.click(screen.getByRole("button", { name: /Outstanding Payments/i }));

    const link = screen.getByRole("link", { name: /More unpaid invoices without an order:\s*2/i });
    expect(link).toHaveAttribute("href", "/en/ws-1/invoices");
  });

  it("opens order details from an awaiting row", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Dashboard />);
    await user.click(screen.getByRole("button", { name: /Outstanding Payments/i }));

    const table = screen.getByRole("table");
    await user.click(within(table).getByText("Unpaid car"));
    expect(openOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "o-unpaid" }));
  });
});
