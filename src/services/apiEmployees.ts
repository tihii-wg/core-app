import type { AddNewEmployeesFormData, EmployeeRole } from "../lib/types";
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
  if (!data) throw new Error("Selected user is not an active member of this workspace");
}

export async function createEmployee({ role, email, name, phone, profile_id, status, workspace_id }: AddNewEmployeesFormData) {
  if (!workspace_id) throw new Error("No active workspace");

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
  if (!workspaceId) throw new Error("No active workspace");

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
