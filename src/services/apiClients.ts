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

export async function getClients() {

  const { data:{ user} } = await supabase.auth.getUser();
  if (!user) throw new Error("User not found");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();
  if (profileError) throw new Error(profileError.message);

  const { data: clients, error } = await supabase.from("clients").select("*").eq("workspace_id", profile.active_workspace_id);

  if (error) throw new Error(error.message);
  // Filters
  // .eq('column', 'Equal to')
  // .gt('column', 'Greater than')
  // .lt('column', 'Less than')
  // .gte('column', 'Greater than or equal to')
  // .lte('column', 'Less than or equal to')
  // .like('column', '%CaseSensitive%')
  // .ilike('column', '%CaseInsensitive%')
  // .is('column', null)
  // .in('column', ['Array', 'Values'])
  // .neq('column', 'Not equal to')

  // // Arrays
  // .contains('array_column', ['array', 'contains'])
  // .containedBy('array_column', ['contained', 'by'])

  // // Logical operators
  // .not('column', 'like', 'Negate filter')
  // .or('some_column.eq.Some value, other_column.eq.Other value')
  return clients;
}
