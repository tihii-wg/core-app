import type { Employee, Order } from "../../lib/types";
import { orderAssignedToEmployee } from "../orders/orderAssignee";
import { isOrderCurrentlyClosed } from "../orders/orderLifecycle";
import { isOpenOrder, isOrderOverdue } from "../orders/orderVisibility";

/** Live order workload for one employee (not period-scoped like Reports). */
export type EmployeeWorkloadCounts = {
  open: number;
  overdue: number;
  /** Orders currently closed (`status === "closed"` and `closedAt` set). */
  closed: number;
};

export type TeamWorkloadSummary = {
  byEmployeeId: Map<string, EmployeeWorkloadCounts>;
  unassigned: EmployeeWorkloadCounts;
  /** Sum of open orders currently assigned to known employees. */
  assignedOpen: number;
};

const emptyCounts = (): EmployeeWorkloadCounts => ({ open: 0, overdue: 0, closed: 0 });

/**
 * Current open/overdue/closed workload from live workspace orders.
 * Assignee matching uses `orders.employee_id` via `orderAssignedToEmployee`.
 * Closed uses `isOrderCurrentlyClosed` (not completed/paid as a stand-in).
 */
export function teamWorkloadSummary(orders: Order[], employees: Employee[], today: string): TeamWorkloadSummary {
  const byEmployeeId = new Map<string, EmployeeWorkloadCounts>();
  for (const employee of employees) {
    byEmployeeId.set(employee.id, emptyCounts());
  }

  let assignedOpen = 0;
  const unassigned = emptyCounts();

  for (const order of orders) {
    const owner = employees.find((employee) => orderAssignedToEmployee(order.assignedEmployeeId, employee));

    if (isOrderCurrentlyClosed(order)) {
      if (owner) {
        const counts = byEmployeeId.get(owner.id) ?? emptyCounts();
        counts.closed += 1;
        byEmployeeId.set(owner.id, counts);
      }
      continue;
    }

    if (!isOpenOrder(order)) continue;

    const overdue = isOrderOverdue(order, today);

    if (owner) {
      const counts = byEmployeeId.get(owner.id) ?? emptyCounts();
      counts.open += 1;
      if (overdue) counts.overdue += 1;
      byEmployeeId.set(owner.id, counts);
      assignedOpen += 1;
      continue;
    }

    // Open orders with no matching roster employee (blank or unknown assignee).
    unassigned.open += 1;
    if (overdue) unassigned.overdue += 1;
  }

  return { byEmployeeId, unassigned, assignedOpen };
}

export function workloadForEmployee(
  orders: Order[],
  employee: Pick<Employee, "id" | "profile_id">,
  today: string,
): EmployeeWorkloadCounts {
  const assigned = orders.filter((order) => orderAssignedToEmployee(order.assignedEmployeeId, employee));
  return {
    open: assigned.filter((order) => isOpenOrder(order)).length,
    overdue: assigned.filter((order) => isOrderOverdue(order, today)).length,
    closed: assigned.filter((order) => isOrderCurrentlyClosed(order)).length,
  };
}
