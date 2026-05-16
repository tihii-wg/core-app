import supabase from "./supabase";

export type createProfileProps = {
  id: number;
  companyName: string;
  ownerName: string;
  avatar: string;
  email: string;
  phone: string;
};

export async function getProfiles() {
  const { data, error } = await supabase.from("profiles").select("*");

  if (error) throw new Error(error.message);

  return data;
}

// export async function createProfile({ id, ownerName, avatar, email, phone }: createProfileProps) {
//   const { data, error } = await supabase.from("profiles").insert([{ id, full_name: ownerName, avatar, email, phone }]);
//   // .select();
//   if (error) throw new Error(error.message);
//   return data;
// }
