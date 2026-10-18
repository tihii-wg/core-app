import type { Employee } from "../../lib/types";

/** Radix Select forbids empty string values — map clear-assignee to this sentinel in the UI. */
export const ORDER_UNASSIGNED_VALUE = "__unassigned__";

export function toAssigneeSelectValue(assignedEmployeeId: string | null | undefined) {
  const id = assignedEmployeeId?.trim() ?? "";
  return id || ORDER_UNASSIGNED_VALUE;
}

export function fromAssigneeSelectValue(value: string) {
  return value === ORDER_UNASSIGNED_VALUE ? "" : value;
}

/**
 * Match an order assignee to an employee row.
 * Canonical assignments use employees.id (orders.employee_id); legacy UI values may still be auth user ids.
 */
export function orderAssignedToEmployee(assignedEmployeeId: string, employee: Pick<Employee, "id" | "profile_id">) {
  if (!assignedEmployeeId) return false;
  return assignedEmployeeId === employee.id || assignedEmployeeId === employee.profile_id;
}

export function employeeNameByAssigneeId(employees: Pick<Employee, "id" | "name" | "profile_id">[]) {
  const names = new Map<string, string>();
  for (const employee of employees) {
    names.set(employee.id, employee.name);
    if (employee.profile_id) names.set(employee.profile_id, employee.name);
  }
  return names;
}
