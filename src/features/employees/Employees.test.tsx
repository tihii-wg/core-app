import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Employee, Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
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

  it("shows open and overdue workload and an unassigned summary", () => {
    employeeHooks.employees = [
      employee({ id: "emp-1", name: "Ada Tech" }),
      employee({ id: "emp-2", name: "Bob Idle", status: "inactive", email: "bob@example.com" }),
    ];
    orderHooks.orders = [
      order({ id: "a", assignedEmployeeId: "emp-1", deadline: "2026-10-01", status: "in-progress" }),
      order({ id: "b", assignedEmployeeId: "emp-1", deadline: "2026-10-12", status: "new" }),
      order({ id: "c", assignedEmployeeId: "", deadline: "2026-10-01", status: "waiting-parts" }),
    ];

    renderWithQuery(<Employees />);

    expect(screen.getByText("Unassigned open orders")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Overdue" })).toBeInTheDocument();

    const adaRow = screen.getByText("Ada Tech").closest("tr");
    expect(adaRow).toBeTruthy();
    expect(within(adaRow!).getByText("2")).toBeInTheDocument();
    expect(within(adaRow!).getByText("1")).toBeInTheDocument();

    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Bob Idle")).toBeInTheDocument();
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
    expect(screen.getByText("Open and overdue counts from current open orders assigned to this employee.")).toBeInTheDocument();
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
});
