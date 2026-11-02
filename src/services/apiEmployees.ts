import type { AddNewEmployeesFormData, EmployeeRole } from "../lib/types";
import i18n from "../i18n";
import supabase from "./supabase";

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

export async function createEmployee({ role, email, name, phone, profile_id, status, workspace_id }: AddNewEmployeesFormData) {
  if (!workspace_id) throw new Error(i18n.t("employees.errors.noActiveWorkspace"));

  if (profile_id) await requireActiveWorkspaceMember(workspace_id, profile_id);

  const { data, error } = await supabase
    .from("employees")
    .insert([
      {
        role,
        email,
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
