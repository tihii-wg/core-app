import type { Employee } from "../../lib/types";

/**
 * Match an order assignee to an employee row.
 * UI / Order.assignedEmployeeId prefer employees.id; orders.assigned_to historically stores auth.users ids
 * (employees.profile_id) because of the FK on assigned_to.
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
