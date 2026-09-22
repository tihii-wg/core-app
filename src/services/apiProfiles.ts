import supabase from "./supabase";

export type createProfileProps = {
  id: number;
  companyName: string;
  ownerName: string;
  avatar: string;
  email: string;
  phone: string;
  activeWorkspaceId: string;
};

export async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) throw new Error(error.message);

  return data;
}

// export async function createProfile({ id, ownerName, avatar, email, phone }: createProfileProps) {
//   const { data, error } = await supabase.from("profiles").insert([{ id, full_name: ownerName, avatar, email, phone }]);
//   // .select();
//   if (error) throw new Error(error.message);
//   return data;
// }
