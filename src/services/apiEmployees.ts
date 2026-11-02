import type { AddNewEmployeesFormData, Employee, EmployeeRole, UpdateEmployeeInput } from "../lib/types";
import i18n from "../i18n";
import supabase from "./supabase";

function toEmployee(row: Record<string, unknown>): Employee {
  const role = row.role;
  const status = row.status === "inactive" ? "inactive" : "active";
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    role: role === "admin" || role === "manager" || role === "technician" || role === "receptionist" ? role : "technician",
    status,
    profile_id: row.profile_id == null || row.profile_id === "" ? null : String(row.profile_id),
    assignedTasks: Number(row.assignedTasks ?? row.assigned_tasks ?? 0) || 0,
    completedTasks: Number(row.completedTasks ?? row.completed_tasks ?? 0) || 0,
  };
}

async function requireActiveWorkspaceMember(workspaceId: string, userId: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("employees.errors.notActiveMember"));
}

export async function createEmployee({ role, name, phone, profile_id, status, workspace_id }: AddNewEmployeesFormData) {
  if (!workspace_id) throw new Error(i18n.t("employees.errors.noActiveWorkspace"));

  if (profile_id) await requireActiveWorkspaceMember(workspace_id, profile_id);

  // Email is not collected on create/edit forms — omit so DB keeps NULL (never write "").
  const { data, error } = await supabase
    .from("employees")
    .insert([
      {
        role,
        name,
        phone,
        profile_id: profile_id || null,
        status,
        workspace_id,
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  return data;
}

function searchTerm(search: string) {
  return search.replace(/[%_,().]/g, " ").trim();
}

export async function getEmployees(search: string, roleFilter: EmployeeRole | null | undefined, workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("employees.errors.noActiveWorkspace"));

  let query = supabase.from("employees").select("*").eq("workspace_id", workspaceId);

  const term = searchTerm(search);
  if (term) {
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,role.ilike.%${term}%,phone.ilike.%${term}%,status.ilike.%${term}%`);
  }
  if (roleFilter) {
    query = query.eq("role", roleFilter);
  }

  const { data: employees, error } = await query;

  if (error) throw new Error(error.message);

  return employees ?? [];
}

/**
 * Updates employee contact/role/status in the active workspace.
 * Does not change workspace_id or profile_id (Auth link stays untouched).
 * Does not rewrite historical orders or related records.
 */
export async function updateEmployee(
  { employeeId, name, phone, role, status }: UpdateEmployeeInput,
  workspaceId: string | undefined,
) {
  if (!workspaceId) throw new Error(i18n.t("employees.errors.noActiveWorkspace"));
  const id = employeeId.trim();
  if (!id) throw new Error(i18n.t("employees.errors.notFoundOrForbidden"));

  const trimmedName = name.trim();
  if (!trimmedName) throw new Error(i18n.t("employees.form.nameRequired"));
  if (role !== "admin" && role !== "manager" && role !== "technician" && role !== "receptionist") {
    throw new Error(i18n.t("employees.form.roleRequired"));
  }
  if (status !== "active" && status !== "inactive") {
    throw new Error(i18n.t("employees.errors.notFoundOrForbidden"));
  }

  // Do not touch email — forms no longer edit it, so existing values must stay intact.
  const { data, error } = await supabase
    .from("employees")
    .update({
      name: trimmedName,
      phone: phone.trim(),
      role,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("employees.errors.notFoundOrForbidden"));
  return toEmployee(data as Record<string, unknown>);
}

/**
 * Archives an employee by setting `status = 'inactive'`.
 * There is no `employees.deleted_at` column; hard DELETE would CASCADE wipe
 * payroll/timesheet/group rows and SET NULL historical order assignees.
 * Inactive technicians are already omitted from new order assignment pickers
 * (`assignableTechnicians`) while remaining visible on historical orders.
 * Does not touch Auth users or `profile_id`.
 */
export async function deactivateEmployee(workspaceId: string | undefined, employeeId: string) {
  if (!workspaceId) throw new Error(i18n.t("employees.errors.noActiveWorkspace"));
  const id = employeeId.trim();
  if (!id) throw new Error(i18n.t("employees.errors.notFoundOrForbidden"));

  const { data, error } = await supabase
    .from("employees")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .neq("status", "inactive")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("employees.errors.notFoundOrForbidden"));
  return { id };
}
