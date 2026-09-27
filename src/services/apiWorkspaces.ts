// import { screen } from "@testing-library/react";
import type { NewWorkspaceData } from "../lib/types";
import { resolveIndustryId } from "./apiIndustries";
import supabase from "./supabase";

export async function getUserWorkspaces() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const withIndustry = `role,
	  workspaces!inner (
    id,
    name,
    owner_id,
    deleted_at,
    industry_id,
    industry:industries (
      id,
      name,
      slug
    )
    )
		`;

  const withoutIndustry = `role,
	  workspaces!inner (
    id,
    name,
    owner_id,
    deleted_at
    )
		`;

  const query = supabase.from("workspace_members").select(withIndustry).eq("user_id", user.id).is("workspaces.deleted_at", null);

  const { data, error } = await query;

  if (error && isMissingIndustrySchema(error)) {
    const fallback = await supabase.from("workspace_members").select(withoutIndustry).eq("user_id", user.id).is("workspaces.deleted_at", null);

    if (fallback.error) throw new Error(fallback.error.message);
    return fallback.data;
  }

  if (error) throw new Error(error.message);

  return data;
}

function isMissingIndustrySchema(error: { code?: string; message?: string }) {
  return error.code === "PGRST205" || error.code === "PGRST200" || error.code === "42703" || error.message?.includes("industries") === true;
}

export async function setActiveWorkspace(id: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("You do not have access to this workspace");

  const { data, error } = await supabase.from("profiles").update({ active_workspace_id: id }).eq("id", user.id).select("active_workspace_id");
  if (error) throw new Error(error.message);

  const activeWorkspaceId = data?.[0]?.active_workspace_id;
  if (!activeWorkspaceId) throw new Error("Workspace was not updated");

  return activeWorkspaceId;
}

export async function createWorkspace(newWorkspaceData: NewWorkspaceData) {
  // create workspace
  const industryId = await resolveIndustryId(newWorkspaceData.industryId);

  const { data, error } = await supabase
    .from("workspaces")
    .insert([
      {
        name: newWorkspaceData.name,
        owner_id: newWorkspaceData.userId,
        industry_id: industryId,
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

export async function updateWorkspaceIndustry(workspaceId: string, industryId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("You do not have access to this workspace");

  const resolvedIndustryId = await resolveIndustryId(industryId);

  const { data, error } = await supabase
    .from("workspaces")
    .update({ industry_id: resolvedIndustryId })
    .eq("id", workspaceId)
    .select("id, industry_id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Workspace was not updated");

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

  const activeWorkspace = members?.flatMap((member) => member?.workspaces) ?? [];

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
