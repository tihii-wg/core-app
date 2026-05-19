import supabase from "./supabase";

type signUpProps = {
  companyName: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
};

type loginProps = {
  email: string;
  password: string;
};

export async function signUp(data: signUpProps) {
  // 1.AUTH USER
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
  if (!user) throw new Error("User not found");

  const { ownerName, phone, companyName } = user.user_metadata ?? {};

  // 2.PROFILE

  const { error: profileError } = await supabase.from("profiles").insert([
    {
      id: user.id,
      full_name: ownerName,
      email: user.email,
      phone: phone,
    },
  ]);

  if (profileError) throw new Error(profileError.message);

  // 3.WORKSPACE
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert([
      {
        name: companyName,
        owner_id: user.id,
      },
    ])
    .select()
    .single();

  if (workspaceError) throw new Error(workspaceError.message);

  // 4.WORKSPACE MEMBER

  const { error: memberError } = await supabase.from("workspace_members").insert([
    {
      workspace_id: workspace.id,
      user_id: user.id,
      role: "owner",
    },
  ]);

  if (memberError) throw new Error(memberError.message);

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

export async function FogotPasword() {
  console.log("fogot password");
}

export async function login({ email, password }: loginProps) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw new Error(error.message);

  return data;
}
