import type { AddNewEmployeesFormData, EmployeeRole } from "../lib/types";
import supabase from "./supabase";

export async function createEmployee({ role, email, name, phone, profile_id, status, workspace_id }: AddNewEmployeesFormData) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User is not authenticated");

  const { data, error } = await supabase
    .from("employees")
    .insert([
      {
        role,
        email,
        name,
        phone,
        profile_id,
        status,
        workspace_id,
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  return data;
}

export async function getEmployees(search: string, roleFilter?: EmployeeRole) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("User not found");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();

  if (profileError) throw new Error(profileError.message);

  let query = supabase.from("employees").select("*").eq("workspace_id", profile.active_workspace_id);

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,role.ilike.%${search}%,phone.ilike.%${search}%,status.ilike.%${search}%`);
  }
  if (roleFilter) {
    query = query.eq("role", roleFilter);
  }

  const { data: employees, error } = await query;

  if (error) throw new Error(error.message);

 

  return employees;
}
