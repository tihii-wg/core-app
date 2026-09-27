import type { AddNewClientFormData, Client, UpdateClientInput } from "../lib/types";
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




export async function getClients(search: string, workspaceId?: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User not found");

  let resolvedWorkspaceId = typeof workspaceId === "string" ? workspaceId : "";
  if (!resolvedWorkspaceId) {
    const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).maybeSingle();
    if (profileError) throw new Error(profileError.message);
    resolvedWorkspaceId = typeof profile?.active_workspace_id === "string" ? profile.active_workspace_id : "";
  }
  if (!resolvedWorkspaceId) throw new Error("No active workspace selected");

  let query = supabase.from("clients").select("*").eq("workspace_id", resolvedWorkspaceId);

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data: clients, error } = await query;

  if (error) throw new Error(error.message);

  return clients ?? [];
}

export async function updateClient({ clientId, clientName, email, phone, address, notes }: UpdateClientInput) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();

  if (profileError) throw new Error(profileError.message);
  if (!profile.active_workspace_id) throw new Error("No active workspace selected");

  const { data: updatedClient, error } = await supabase
    .from("clients")
    .update({
      name: clientName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      address: address?.trim() ?? "",
      notes: notes?.trim() ?? "",
    })
    .eq("id", clientId)
    .eq("workspace_id", profile.active_workspace_id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  return updatedClient as Client;
}
