import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../lib/types";
import AppTopbarNotifications from "./AppTopbarNotifications";

const orderHooks = vi.hoisted(() => ({
  orders: [] as Order[],
  isLoading: false,
  error: null as Error | null,
}));

const openOrder = vi.hoisted(() => vi.fn());

vi.mock("../features/orders/useGetOrders", () => ({
  useGetOrders: () => ({
    orders: orderHooks.orders,
    isLoading: orderHooks.isLoading,
    error: orderHooks.error,
    refetch: vi.fn(),
  }),
  useUpdateOrderStatus: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../features/profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../features/orders/useOrderDetails", () => ({
  useOrderDetails: () => ({
    openOrder,
    syncOrder: vi.fn(),
    changeStatus: vi.fn(),
    isStatusUpdating: false,
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

vi.mock("../features/orders/OrderDetailPanel", () => ({
  default: () => null,
}));

function order(partial: Partial<Order>): Order {
  return {
    id: "order-1",
    clientId: "client-1",
    clientName: "Ada Lovelace",
    orderNumber: "ORD-2026-001",
    device: "BMW",
    vin: "",
    carNumber: "",
    service: "Oil",
    services: [],
    description: "",
    status: "in-progress",
    assignedEmployeeId: "emp-1",
    assignedEmployeeName: "Ada Tech",
    deadline: "2026-10-01",
    totalPrice: 40,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-09-26",
    updatedAt: "2026-09-26",
    ...partial,
  };
}

function renderNotifications(ui: ReactElement = <AppTopbarNotifications />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/en/ws-1/dashboard"]}>
          <Routes>
            <Route path="/:locale/:workspaceId/*" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

describe("AppTopbarNotifications", () => {
  beforeEach(() => {
    openOrder.mockReset();
    orderHooks.orders = [];
    orderHooks.isLoading = false;
    orderHooks.error = null;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an empty state and no unread badge when there are no actionable orders", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    orderHooks.orders = [order({ status: "completed", deadline: "2026-10-01" })];
    renderNotifications();

    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByText(/Live alerts from current open orders/)).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /View orders/i })).toBeInTheDocument();
  });

  it("lists overdue, upcoming, and unassigned alerts with a count badge", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    orderHooks.orders = [
      order({ id: "overdue-1", orderNumber: "ORD-OVER", deadline: "2026-10-01", status: "waiting-parts" }),
      order({ id: "soon-1", orderNumber: "ORD-SOON", clientName: "Bob", deadline: "2026-10-12", status: "new" }),
      order({ id: "free-1", orderNumber: "ORD-FREE", clientName: "Cara", assignedEmployeeId: "", assignedEmployeeName: "", deadline: "2026-11-01", status: "new" }),
    ];
    renderNotifications();

    const bell = screen.getByRole("button", { name: /Notifications, 3 alerts/i });
    expect(within(bell).getByText("3")).toBeInTheDocument();

    await user.click(bell);
    expect(await screen.findByText("ORD-OVER is overdue")).toBeInTheDocument();
    expect(screen.getByText("ORD-SOON deadline upcoming")).toBeInTheDocument();
    expect(screen.getByText("ORD-FREE has no assignee")).toBeInTheDocument();
  });

  it("opens the order details flow when an alert is selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const overdue = order({ id: "overdue-1", orderNumber: "ORD-OVER", deadline: "2026-10-01" });
    orderHooks.orders = [overdue];
    renderNotifications();

    await user.click(screen.getByRole("button", { name: /Notifications, 1 alert/i }));
    await user.click(await screen.findByText("ORD-OVER is overdue"));

    expect(openOrder).toHaveBeenCalledWith(overdue);
  });

  it("dismisses current alerts for the session without inventing persistence", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    orderHooks.orders = [order({ id: "overdue-1", orderNumber: "ORD-OVER", deadline: "2026-10-01" })];
    renderNotifications();

    await user.click(screen.getByRole("button", { name: /Notifications, 1 alert/i }));
    await user.click(await screen.findByRole("button", { name: "Dismiss all" }));

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    // Trigger stays labelled without a count once alerts are dismissed (may be aria-hidden while the menu is open).
    expect(screen.getByRole("button", { name: "Notifications", hidden: true })).toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("shows a load error state when orders fail", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    orderHooks.error = new Error("network");
    renderNotifications();

    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Could not load order alerts")).toBeInTheDocument();
  });
});
