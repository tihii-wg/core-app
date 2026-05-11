import supabase from "./supabase";

export async function FogotPasword() {
  console.log("fogot password");
}
type signUpProps = {
  companyName: string;
  ownerName: string;
  email: string;
  password: string;
};

export async function signUp(data: signUpProps) {
  const { data: authData, error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    
  });
  if (error) {
    throw new Error(error.message);
  }

  const user = authData.user;

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}
