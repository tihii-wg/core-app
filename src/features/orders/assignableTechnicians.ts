import type { Employee } from "../../lib/types";

export type AssignableTechnician = {
  /** employees.id — form value; persisted via the employee's linked auth user when the schema requires it. */
  id: string;
  name: string;
};

function isAssignableTechnician(employee: Employee) {
  return Boolean(employee.id) && employee.status === "active" && employee.role === "technician";
}

/**
 * Order assignees come from the employees roster (technicians who perform work), not from
 * workspace_members (app access). An employee does not need a login account to appear here.
 * Inactive technicians are omitted, except the current assignee when editing an order.
 */
export function assignableTechnicians(employees: Employee[] | undefined, currentAssigneeId?: string | null): AssignableTechnician[] {
  const options = (employees ?? []).filter(isAssignableTechnician).map((employee) => ({
    id: String(employee.id),
    name: employee.name?.trim() || String(employee.id),
  }));

  const currentId = currentAssigneeId?.trim() ? String(currentAssigneeId.trim()) : "";
  if (currentId && !options.some((option) => option.id === currentId)) {
    const current =
      (employees ?? []).find((employee) => String(employee.id) === currentId) ??
      (employees ?? []).find((employee) => employee.profile_id != null && String(employee.profile_id) === currentId);
    if (current) {
      options.push({
        id: String(current.id),
        name: current.name?.trim() || String(current.id),
      });
    }
  }

  return options.sort((a, b) => a.name.localeCompare(b.name));
}
