import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Employee, Order } from "../../lib/types";
import { stubLocalStorage } from "../../tests/memoryStorage";
import { renderWithQuery } from "../../tests/renderQuery";
import { EMPLOYEE_COLUMN_STORAGE_KEY } from "./employeeColumnVisibility";
import { Employees } from "./Employees";

const employeeHooks = vi.hoisted(() => ({
  employees: [] as Employee[],
  isLoading: false,
  isPending: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

const orderHooks = vi.hoisted(() => ({
  orders: [] as Order[],
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("./useGetEmployees", () => ({
  default: () => ({
    employees: employeeHooks.employees,
    isLoading: employeeHooks.isLoading,
    isPending: employeeHooks.isPending,
    error: employeeHooks.error,
    refetch: employeeHooks.refetch,
  }),
}));

vi.mock("../orders/useGetOrders", () => ({
  useGetOrders: () => ({
    orders: orderHooks.orders,
    isLoading: orderHooks.isLoading,
    error: orderHooks.error,
    refetch: vi.fn(),
  }),
  useUpdateOrderStatus: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("./AddNewEmployeesForm", () => ({
  default: () => <div>Create form</div>,
}));

vi.mock("./EditEmployeeForm", () => ({
  default: ({ employee }: { employee: Employee }) => <div>Edit form for {employee.name}</div>,
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true, isEntitlementPending: false }),
  useGuardSubscriptionWrite: () => () => undefined,
  SubscriptionReadOnlyNotice: () => null,
}));

vi.mock("../workspaces/SubscriptionReadOnlyNotice", () => ({
  SubscriptionReadOnlyNotice: () => null,
}));

function employee(partial: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    name: "Ada Tech",
    email: "ada@example.com",
    phone: "+37360000001",
    role: "technician",
    assignedTasks: 0,
    completedTasks: 0,
    status: "active",
    profile_id: null,
    ...partial,
  };
}

function order(partial: Partial<Order>): Order {
  return {
    id: "order-1",
    clientId: "client-1",
    clientName: "Client",
    orderNumber: "ORD-1",
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
    totalPrice: 10,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-09-26",
    updatedAt: "2026-09-26",
    ...partial,
  };
}

describe("Employees", () => {
  beforeEach(() => {
    stubLocalStorage();
    employeeHooks.employees = [];
    employeeHooks.isLoading = false;
    employeeHooks.isPending = false;
    employeeHooks.error = null;
    orderHooks.orders = [];
    orderHooks.isLoading = false;
    orderHooks.error = null;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an empty state when the workspace has no employees", () => {
    renderWithQuery(<Employees />);
    expect(screen.getByText(/No employees/i)).toBeInTheDocument();
  });

  it("shows open, overdue, and closed workload and an unassigned summary", () => {
    employeeHooks.employees = [
      employee({ id: "emp-1", name: "Ada Tech" }),
      employee({ id: "emp-2", name: "Bob Idle", status: "inactive", email: "bob@example.com" }),
    ];
    orderHooks.orders = [
      order({ id: "a", assignedEmployeeId: "emp-1", deadline: "2026-10-01", status: "in-progress" }),
      order({ id: "b", assignedEmployeeId: "emp-1", deadline: "2026-10-12", status: "new" }),
      order({ id: "c", assignedEmployeeId: "", deadline: "2026-10-01", status: "waiting-parts" }),
      order({
        id: "d",
        assignedEmployeeId: "emp-1",
        status: "closed",
        closedAt: "2026-10-05T12:00:00.000Z",
      }),
      order({
        id: "e",
        assignedEmployeeId: "emp-2",
        status: "closed",
        closedAt: "2026-10-06T12:00:00.000Z",
      }),
    ];

    renderWithQuery(<Employees />);

    expect(screen.getByText("Unassigned open orders")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Overdue" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Closed Orders" })).toBeInTheDocument();

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "");
    const openIdx = headers.indexOf("Open");
    const overdueIdx = headers.indexOf("Overdue");
    const closedIdx = headers.indexOf("Closed Orders");
    expect(openIdx).toBeGreaterThan(-1);
    expect(overdueIdx).toBeGreaterThan(-1);
    expect(closedIdx).toBeGreaterThan(-1);

    const adaCells = within(screen.getByText("Ada Tech").closest("tr")!).getAllByRole("cell");
    expect(adaCells[openIdx]).toHaveTextContent("2");
    expect(adaCells[overdueIdx]).toHaveTextContent("1");
    expect(adaCells[closedIdx]).toHaveTextContent("1");

    const bobCells = within(screen.getByText("Bob Idle").closest("tr")!).getAllByRole("cell");
    expect(bobCells[openIdx]).toHaveTextContent("0");
    expect(bobCells[overdueIdx]).toHaveTextContent("0");
    expect(bobCells[closedIdx]).toHaveTextContent("1");

    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows a no-assigned-work empty hint when employees exist without open orders", () => {
    employeeHooks.employees = [employee()];
    orderHooks.orders = [order({ status: "completed" })];

    renderWithQuery(<Employees />);

    expect(screen.getByText("No open orders are assigned to the team right now.")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned open orders")).not.toBeInTheDocument();
  });

  it("opens the existing detail panel from a row click with live workload", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    employeeHooks.employees = [employee({ id: "emp-1", name: "Ada Tech" })];
    orderHooks.orders = [
      order({ assignedEmployeeId: "emp-1", deadline: "2026-10-01", status: "in-progress" }),
      order({ id: "o2", assignedEmployeeId: "emp-1", deadline: "2026-10-12", status: "new" }),
    ];

    renderWithQuery(<Employees />);
    await user.click(screen.getByText("Ada Tech"));

    expect(await screen.findByText("Current workload")).toBeInTheDocument();
    expect(
      screen.getByText("Open, overdue, and closed counts from orders currently assigned to this employee."),
    ).toBeInTheDocument();
  });

  it("notes that inactive employees are not offered for new assignments", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    employeeHooks.employees = [employee({ id: "emp-2", name: "Bob Idle", status: "inactive" })];
    orderHooks.orders = [order({ assignedEmployeeId: "emp-2", deadline: "2026-10-01" })];

    renderWithQuery(<Employees />);
    await user.click(screen.getByText("Bob Idle"));

    expect(
      await screen.findByText(/Inactive employees stay on historical assignments but are not offered for new order assignments/i),
    ).toBeInTheDocument();
  });

  it("opens the edit dialog from the pencil without opening the detail panel", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    employeeHooks.employees = [
      employee({ id: "emp-1", name: "Ada Tech", profile_id: null }),
      employee({ id: "emp-2", name: "Bob Idle", status: "inactive" }),
    ];

    renderWithQuery(<Employees />);

    expect(screen.getByRole("button", { name: "Edit employee Ada Tech" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit employee Bob Idle" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit employee Ada Tech" }));

    expect(await screen.findByText("Edit Employee")).toBeInTheDocument();
    expect(screen.getByText("Edit form for Ada Tech")).toBeInTheDocument();
    expect(screen.queryByText("Current workload")).not.toBeInTheDocument();
  });

  it("lets the user hide and show employee fields from the Columns menu", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    employeeHooks.employees = [employee({ id: "emp-1", name: "Ada Tech" })];

    renderWithQuery(<Employees />);

    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Closed Orders" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Closed Orders" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Role" }));
    expect(screen.queryByRole("columnheader", { name: "Role" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(EMPLOYEE_COLUMN_STORAGE_KEY) ?? "[]")).not.toContain("role");

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Closed Orders" }));
    expect(screen.queryByRole("columnheader", { name: "Closed Orders" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Closed Orders" }));
    expect(screen.getByRole("columnheader", { name: "Closed Orders" })).toBeInTheDocument();
  });

  it("restores the saved column selection on load and keeps name/actions visible", () => {
    window.localStorage.setItem(EMPLOYEE_COLUMN_STORAGE_KEY, JSON.stringify(["open", "closed"]));
    employeeHooks.employees = [employee({ id: "emp-1", name: "Ada Tech" })];

    renderWithQuery(<Employees />);

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Closed Orders" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Overdue" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit employee Ada Tech" })).toBeInTheDocument();
  });

  it("keeps search and filters working after column preferences change", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    employeeHooks.employees = [employee({ id: "emp-1", name: "Ada Tech" })];

    renderWithQuery(<Employees />);
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Status" }));

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
  });
});
