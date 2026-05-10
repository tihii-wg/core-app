import supabase from "./supabase";

export async function getProfiles() {
  const { data, error } = await supabase.from("profiles").select("*");

  if (error) {
    console.error(error);
    throw new Error("Profiles could not be loaded");
  }
  return data;
}
