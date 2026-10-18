import { describe, expect, it } from "vitest";
import type { Employee, Order } from "../../lib/types";
import { teamWorkloadSummary, workloadForEmployee } from "./employeeWorkload";

function employee(partial: Partial<Employee>): Employee {
  return {
    id: "emp-1",
    name: "Ada",
    email: "ada@example.com",
    phone: "+37360000000",
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
    assignedEmployeeName: "Ada",
    deadline: "2026-10-10",
    totalPrice: 10,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...partial,
  };
}

const today = "2026-10-10";

describe("teamWorkloadSummary", () => {
  it("counts open and overdue work per employee and for unassigned orders", () => {
    const employees = [
      employee({ id: "emp-1", name: "Ada", profile_id: "profile-ada" }),
      employee({ id: "emp-2", name: "Bob", status: "inactive" }),
    ];
    const orders = [
      order({ id: "o1", assignedEmployeeId: "emp-1", deadline: "2026-10-01", status: "waiting-parts" }),
      order({ id: "o2", assignedEmployeeId: "profile-ada", deadline: "2026-10-12", status: "new" }),
      order({ id: "o3", assignedEmployeeId: "emp-2", deadline: "2026-09-01", status: "in-progress" }),
      order({ id: "o4", assignedEmployeeId: "", deadline: "2026-10-01", status: "new" }),
      order({ id: "o5", assignedEmployeeId: "unknown", deadline: "2026-10-12", status: "new" }),
      order({ id: "o6", assignedEmployeeId: "emp-1", deadline: "2026-10-01", status: "completed" }),
      order({ id: "o7", assignedEmployeeId: "", deadline: "2026-10-01", status: "cancelled" }),
    ];

    const summary = teamWorkloadSummary(orders, employees, today);

    expect(summary.byEmployeeId.get("emp-1")).toEqual({ open: 2, overdue: 1 });
    expect(summary.byEmployeeId.get("emp-2")).toEqual({ open: 1, overdue: 1 });
    expect(summary.unassigned).toEqual({ open: 2, overdue: 1 });
    expect(summary.assignedOpen).toBe(3);
  });

  it("returns zero counts when there are no open orders", () => {
    const employees = [employee({ id: "emp-1" })];
    const summary = teamWorkloadSummary(
      [order({ status: "completed", deadline: "2026-10-01" }), order({ status: "paid", isPaid: true, assignedEmployeeId: "" })],
      employees,
      today,
    );

    expect(summary.byEmployeeId.get("emp-1")).toEqual({ open: 0, overdue: 0 });
    expect(summary.unassigned).toEqual({ open: 0, overdue: 0 });
    expect(summary.assignedOpen).toBe(0);
  });

  it("still counts historical open work on inactive employees without offering them as new assignees elsewhere", () => {
    const inactive = employee({ id: "emp-old", status: "inactive" });
    const summary = teamWorkloadSummary(
      [order({ assignedEmployeeId: "emp-old", deadline: "2026-10-01", status: "in-progress" })],
      [inactive],
      today,
    );

    expect(summary.byEmployeeId.get("emp-old")).toEqual({ open: 1, overdue: 1 });
    expect(summary.unassigned).toEqual({ open: 0, overdue: 0 });
  });
});

describe("workloadForEmployee", () => {
  it("matches an employee by id or profile_id", () => {
    const emp = employee({ id: "emp-1", profile_id: "auth-1" });
    const orders = [
      order({ id: "a", assignedEmployeeId: "emp-1", deadline: "2026-10-12", status: "new" }),
      order({ id: "b", assignedEmployeeId: "auth-1", deadline: "2026-10-01", status: "waiting-parts" }),
    ];

    expect(workloadForEmployee(orders, emp, today)).toEqual({ open: 2, overdue: 1 });
  });
});
