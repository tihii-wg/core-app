import supabase from "./supabase";

export async function FogotPasword() {
  console.log("fogot password");
}
type signUpProps = {
  companyName: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
};

export async function signUp(data: signUpProps) {
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        phone: data.phone,
        companyName: data.companyName,
        ownerName: data.ownerName,
      },
    },
  });
  if (authError) {
    console.log(`Auth error --${authError.message}`);
    throw new Error(authError.message);
  }

  const user = authData.user;

  return user;
}

export async function getCurrentUser() {
  const { data: session } = await supabase.auth.getSession();

  if (!session?.session) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);

  return data?.user;
}

export async function logOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
