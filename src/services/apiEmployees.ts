import type { AddNewEmployeesFormData } from "../lib/types";
import supabase from "./supabase";

export async function createEmployee({ role, email, name, phone, profile_id, status, workspace_id }: AddNewEmployeesFormData) {
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
