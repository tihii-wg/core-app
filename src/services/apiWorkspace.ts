import type { WorkspaceMemberWithWorkspace } from "../lib/types";
import supabase from "./supabase";

export async function getUserWorkspace(): Promise<WorkspaceMemberWithWorkspace[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: session } = await supabase.auth.getSession();

  if (!user) throw new Error("User not found");

  if (!session.session) return null;

  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      `role,
	  workspace:workspaces (
    id,
    name,
    owner_id,
    type
    )
		`
    )
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  return data;
}

export async function setActiveWorkspace(id: string) {
  const { error: error1 } = await supabase.from("workspaces").update({ type: "second" }).neq("id", id);

  if (error1) throw new Error(error1.message);

  const { error: error2 } = await supabase.from("workspaces").update({ type: "current" }).eq("id", id);

  if (error2) throw new Error(error2.message);
}
