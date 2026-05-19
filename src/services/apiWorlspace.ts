import supabase from "./supabase";

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
};

export type WorkspaceMemberWithWorkspace = {
  role: string;
  workspace: Workspace[];
};
 

export async function getUserWorkspace(): Promise<WorkspaceMemberWithWorkspace[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      `role,
	  workspace:workspaces (
    id,
    name,
    owner_id
    )
		`
    )
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  return data
  
}
