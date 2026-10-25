import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../tests/renderQuery";
import Dashboard from "./Dashboard";

const subscriptionState = vi.hoisted(() => ({
  canWrite: true,
  status: "active" as string | null,
  expiresAt: null as string | null,
  isLoading: false,
  isEntitlementPending: false,
  error: null as Error | null,
}));

vi.mock("../features/workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({
    canWrite: subscriptionState.canWrite,
    status: subscriptionState.status,
    expiresAt: subscriptionState.expiresAt,
    startedAt: null,
    updatedAt: null,
    isLoading: subscriptionState.isLoading,
    isEntitlementPending: subscriptionState.isEntitlementPending,
    isEntitlementResolved: !subscriptionState.isEntitlementPending,
    isFetching: false,
    isFetched: true,
    error: subscriptionState.error,
    refetch: vi.fn(),
    workspaceId: "ws-1",
    subscription: null,
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: () => ({ locale: "en", workspaceId: "ws-1" }),
    Link: ({ children, ...props }: { children?: React.ReactNode; to?: string }) => <a href={props.to}>{children}</a>,
  };
});

vi.mock("../lib/appContext", () => ({
  useApp: () => ({ setCurrentModule: vi.fn() }),
}));

vi.mock("../features/profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../features/orders/useOrderDetails", () => ({
  useOrderDetails: () => ({
    selectedOrder: null,
    detailPanelOpen: false,
    setDetailPanelOpen: vi.fn(),
    openOrder: vi.fn(),
    changeStatus: vi.fn(),
    isStatusUpdating: false,
    onOrderUpdated: vi.fn(),
  }),
}));

vi.mock("../features/inventory/useGetInventoryItems", () => ({
  useGetInventoryItems: () => ({
    items: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../features/workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${value}`,
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

vi.mock("../features/dashboard/DashboardFinancialCards", () => ({
  DashboardFinancialCards: () => <div data-testid="dashboard-financial-cards">Financial cards</div>,
}));

vi.mock("../features/dashboard/DashboardDeadlinePanels", () => ({
  DashboardDeadlinePanels: () => <div data-testid="dashboard-deadline-panels">Deadlines</div>,
}));

vi.mock("../features/dashboard/DashboardQuickActions", () => ({
  DashboardQuickActions: () => <div data-testid="dashboard-quick-actions">Quick actions</div>,
}));

vi.mock("../features/orders/CreateOrderDialog", () => ({ CreateOrderDialog: () => null }));
vi.mock("../features/clients/AddClientDialog", () => ({ AddClientDialog: () => null }));
vi.mock("../features/inventory/AddInventoryItemDialog", () => ({ AddInventoryItemDialog: () => null }));
vi.mock("../features/inventory/EditInventoryItemDialog", () => ({ EditInventoryItemDialog: () => null }));
vi.mock("../features/orders/OrderDetailPanel", () => ({ default: () => null }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({
      data: [],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
    }),
  };
});

function renderDashboard() {
  return renderWithQuery(<Dashboard />);
}

describe("Dashboard subscription notice", () => {
  beforeEach(() => {
    subscriptionState.canWrite = true;
    subscriptionState.status = "active";
    subscriptionState.expiresAt = null;
    subscriptionState.isLoading = false;
    subscriptionState.isEntitlementPending = false;
    subscriptionState.error = null;
  });

  it("does not show a read-only notice when the workspace has write entitlement", () => {
    renderDashboard();

    expect(screen.getByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-financial-cards")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/view-only/i)).not.toBeInTheDocument();
  });

  it("does not flash a read-only notice while subscription entitlement is still loading", () => {
    subscriptionState.canWrite = false;
    subscriptionState.isEntitlementPending = true;
    subscriptionState.isLoading = true;
    subscriptionState.status = null;

    renderDashboard();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/view-only/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-financial-cards")).toBeInTheDocument();
  });

  it("shows the shared read-only notice above dashboard cards when write entitlement is denied", () => {
    subscriptionState.canWrite = false;
    subscriptionState.status = "expired";
    subscriptionState.expiresAt = "2025-01-01T00:00:00.000Z";

    renderDashboard();

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/view-only/i);
    expect(notice).toHaveTextContent(/Expired/i);
    expect(screen.getByTestId("dashboard-financial-cards")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-quick-actions")).toBeInTheDocument();

    const header = screen.getByRole("heading", { name: /dashboard/i });
    expect(header.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(screen.getByTestId("dashboard-financial-cards")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
