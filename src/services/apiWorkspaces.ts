// import { screen } from "@testing-library/react";
import type { NewWorkspaceData } from "../lib/types";
import supabase from "./supabase";

export async function getUserWorkspaces() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      `role,
	  workspaces!inner (
    id,
    name,
    owner_id,
    deleted_at
    )
		`
    )
    .eq("user_id", user.id)
    .is("workspaces.deleted_at", null);

  if (error) throw new Error(error.message);

  return data;
}

export async function setActiveWorkspace(id: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const { data, error } = await supabase.from("profiles").update({ active_workspace_id: id }).eq("id", user.id).select();
  if (error) throw new Error(error.message);

  const profile = data.at(0).active_workspace_id;

  return profile;
}

export async function createWorkspace(newWorkspaceData: NewWorkspaceData) {
  // create workspace
  const { data, error } = await supabase
    .from("workspaces")
    .insert([
      {
        name: newWorkspaceData.name,
        owner_id: newWorkspaceData.userId,
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
  //1 get user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  //2 role must be owner

  const { data: currentMember, error: currentMemberError } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).single();

  if (currentMemberError) throw new Error(currentMemberError.message);

  if (currentMember.role !== "owner") {
    throw new Error("Only owner can delete workspace");
  }

  //3 get all not deleted workspaces

  const { data: members, error: membersError } = await supabase
    .from("workspace_members")
    .select(
      `role,
    workspaces!inner(
      id,
      deleted_at
    )
  	`
    )
    .eq("user_id", user.id)
    .is("workspaces.deleted_at", null);

  const activeWorkspace = members?.flatMap((member) => member?.workspaces);

  if (membersError) throw new Error(membersError.message);

  if (!members) throw new Error("Workspaces not found");

  if (activeWorkspace.length === 1) throw new Error("You cannot delete last workspace");

  //4 Get profiles

  const { data: profiles, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id);

  if (profileError) throw new Error(profileError.message);
  const profile = profiles?.[0];
  if (!profile) throw new Error("Profile not found");

  //5 If current workspace === workspaceId find next workspace and chenge current_workspace_id

  let nextWorkspaceId = profile.active_workspace_id;

  if (profile.active_workspace_id === workspaceId) {
    const nextWorkspace = activeWorkspace.find((w) => w.id !== workspaceId);

    if (!nextWorkspace) throw new Error("No workspaceAvilable");

    nextWorkspaceId = nextWorkspace.id;

    const { error: chengeProfileDataError } = await supabase.from("profiles").update({ active_workspace_id: nextWorkspace.id }).eq("id", user.id);

    if (chengeProfileDataError) throw new Error(chengeProfileDataError.message);
  }
  //6 Delete member

  const { error: deleteMemberError } = await supabase.from("workspace_members").update({ deleted_at: new Date().toISOString() }).eq("workspace_id", workspaceId);

  if (deleteMemberError) throw new Error(deleteMemberError.message);

  //7 Delete workspace

  const { data, error } = await supabase.from("workspaces").update({ deleted_at: new Date().toISOString() }).eq("id", workspaceId).select();

  if (error) throw new Error(error.message);

  return {
    deleteWorkspace: data,
    nextWorkspaceId,
  };
}
