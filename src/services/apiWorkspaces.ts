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
  const { error: error1 } = await supabase.from("workspaces").update({ type: "inactive" }).neq("id", id);

  if (error1) throw new Error(error1.message);

  const { data, error: error2 } = await supabase.from("workspaces").update({ type: "current" }).eq("id", id).select();

  if (error2) throw new Error(error2.message);

  const workspace = data.find((w) => w.type === "current");

  return workspace;
}

export async function createWorkspace(newWorkspaceData) {
  // create workspace
  const { data, error } = await supabase
    .from("workspaces")
    .insert([
      {
        name: newWorkspaceData.name,
        owner_id: newWorkspaceData.userId,
        type: "second",
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  const workspaceId = data.flatMap((d) => d.id);

  // create workspace member
  const { error: error2 } = await supabase
    .from("workspace_members")
    .insert([
      {
        workspace_id: workspaceId[0],
        role: newWorkspaceData.role.toLowerCase(),
        user_id: newWorkspaceData.userId,
      },
    ])
    .select();
  if (error2) throw new Error(error2.message);

  return data;
}

export async function deleteWorkspace(workspaceId: string) {
  //delete workspacew
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("User not found");

  const { data: workspaces, error } = await supabase
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

  if (workspaces.length === 1) throw new Error("You cannot delete your last workspace");

  const currentWorkspace = workspaces.flatMap((w) => w.workspaces).find((w) => w.type === "current");

  if (currentWorkspace?.id === workspaceId) {
    const nextCurrentWorkspace = workspaces.flatMap((w) => w.workspaces).find((w) => w.id !== workspaceId);

    await supabase.from("workspaces").update({ type: "inactive" }).eq("id", workspaceId);

    await supabase.from("workspaces").update({ type: "current" }).eq("id", nextCurrentWorkspace.id);
  }

  const { error: workspaceError } = await supabase.from("workspaces").delete().eq("id", workspaceId);

  if (workspaceError) throw new Error(workspaceError.message);

  //delete workspace member
  const { error: memberError } = await supabase.from("workspace_members").delete().eq("workspace_id", workspaceId);

  if (memberError) throw new Error(memberError.message);

  // delete clients

  // delele orders

  return { workspaces, workspaceError, memberError };
}
