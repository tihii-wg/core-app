import type { addNewServiceForm } from "../lib/types";
import supabase from "./supabase";

export async function createService({ serviceName, status, price, description }:addNewServiceForm) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();

  if (profileError) throw new Error(profileError.message);
  if (!profile.active_workspace_id) throw new Error("No active workspace selected");

  const { data, error } = await supabase
    .from("services")
    .insert([
      {
        workspace_id: profile.active_workspace_id,
        service_name: serviceName,
        service_price: price,
        description: description || null,
        status: status,
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  return data;
}
export async function getservices() {
	
}