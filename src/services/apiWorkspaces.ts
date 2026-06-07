import type { WorkspaceMemberWithWorkspace } from "../lib/types";
import supabase from "./supabase";

export async function getUserWorkspaces(): Promise<WorkspaceMemberWithWorkspace[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      `role,
	  workspaces:workspaces (
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

  const { data, error: error2 } = await supabase.from("workspaces").update({ type: "current" }).eq("id", id).select();

  if (error2) throw new Error(error2.message);

  const workspace = data.find((w) => w.type === "current");

  return workspace;
}
