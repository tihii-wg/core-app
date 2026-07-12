import type { AddNewClientFormData } from "../lib/types";
import supabase from "./supabase";

export async function createClient({ workspace_id, clientName, email, phone, address, notes }: AddNewClientFormData) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User is not authenticated");

  const { data, error } = await supabase
    .from("clients")
    .insert([
      {
        workspace_id,
        name: clientName,
        email,
        phone,
        address,
        notes,
        added_by: user.id,
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  return data;
}

export async function getClients(search:string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("User not found");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();
  if (profileError) throw new Error(profileError.message);


  let query = supabase.from("clients").select("*").eq("workspace_id", profile.active_workspace_id);


  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
}

  const { data: clients, error } = await query;

  if (error) throw new Error(error.message);

  return clients;
}
