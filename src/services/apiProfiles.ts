import supabase from "./supabase";

type createProfileProps = {
  id: number;
  companyName: string;
  ownerName: string;
  avatar: string;
};

export async function getProfiles() {
  const { data, error } = await supabase.from("profiles").select("*");

  if (error) throw new Error(error.message);

  return data;
}

export async function createProfise({ id, ownerName, avatar }: createProfileProps) {
  const { data, error } = await supabase
    .from("profiles")
    .insert([{ id, full_name: ownerName, avatar }])
    .select();
  if (error) throw new Error(error.message);
  return data;
}
