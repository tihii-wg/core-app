import type { AddNewClientFormData } from "../lib/types";
import supabase from "./supabase";

export async function createClient({ clientName, email, phone, address, notes }: AddNewClientFormData) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User is not authenticated");

  const { data, error } = await supabase
    .from("clients")
    .insert([
      {
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
