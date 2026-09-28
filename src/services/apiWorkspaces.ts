// import { screen } from "@testing-library/react";
import type { NewWorkspaceData } from "../lib/types";
import { resolveIndustryId } from "./apiIndustries";
import supabase from "./supabase";

type MembershipResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type ListedWorkspace = {
  id: string;
  name: string;
  avatar_path?: string | null;
};

export type ListedWorkspaceMembership = {
  workspaces: ListedWorkspace | ListedWorkspace[] | null;
};

export async function getUserWorkspaces() {
  const user = await currentUser();

  const data = await selectMembership((select) => supabase.from("workspace_members").select(select).eq("user_id", user.id).is("workspaces.deleted_at", null) as unknown as PromiseLike<MembershipResult>);

  return (Array.isArray(data) ? data : []) as ListedWorkspaceMembership[];
}

function membershipSelect(options: { industry: boolean; avatar: boolean; markup: boolean }) {
  const fields = ["id", "name", "owner_id", "deleted_at", "industry_id"];
  if (options.avatar) fields.push("avatar_path");
  if (options.markup) fields.push("inventory_markup");
  const industry = options.industry
    ? `,
    industry:industries (
      id,
      name,
      slug
    )`
    : "";

  return `role,
  workspaces!inner (
    ${fields.join(",\n    ")}${industry}
  )`;
}

function isMissingAvatarColumn(error: { code?: string; message?: string }) {
  return (error.code === "42703" || error.code === "PGRST204") && error.message?.includes("avatar_path") === true;
}

function isMissingIndustrySchema(error: { code?: string; message?: string }) {
  if (error.message?.includes("avatar_path") || error.message?.includes("inventory_markup")) return false;
  return error.code === "PGRST205" || error.code === "PGRST200" || error.code === "42703" || error.message?.includes("industries") === true;
}

function isMissingMarkupColumn(error: { code?: string; message?: string }) {
  return (error.code === "42703" || error.code === "PGRST204") && error.message?.includes("inventory_markup") === true;
}

async function selectMembership(run: (select: string) => PromiseLike<MembershipResult>) {
  let industry = true;
  let avatar = true;
  let markup = true;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await run(membershipSelect({ industry, avatar, markup }));
    if (!error) return data;
    if (markup && isMissingMarkupColumn(error)) {
      markup = false;
      continue;
    }
    if (avatar && isMissingAvatarColumn(error)) {
      avatar = false;
      continue;
    }
    if (industry && isMissingIndustrySchema(error)) {
      industry = false;
      continue;
    }
    throw new Error(error.message);
  }

  throw new Error("Workspace could not be loaded");
}

export type WorkspaceDetails = {
  id: string;
  name: string;
  ownerId: string | null;
  industryId: string | null;
  industryName: string | null;
  avatarPath: string | null;
  inventoryMarkup: number | null;
  role: string;
};

function firstRecord(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function readInventoryMarkup(value: unknown) {
  if (value == null || value === "") return null;
  const markup = typeof value === "number" ? value : Number(value);
  return Number.isFinite(markup) ? markup : null;
}

export function toWorkspaceDetails(row: unknown): WorkspaceDetails | null {
  const member = firstRecord(row);
  if (!member || typeof member !== "object") return null;

  const membership = member as Record<string, unknown>;
  const workspace = firstRecord(membership.workspaces);
  if (!workspace || typeof workspace !== "object") return null;

  const record = workspace as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id || record.deleted_at) return null;

  const industry = firstRecord(record.industry);
  const industryRecord = industry && typeof industry === "object" ? (industry as Record<string, unknown>) : null;

  return {
    id: record.id,
    name: typeof record.name === "string" ? record.name : "",
    ownerId: typeof record.owner_id === "string" ? record.owner_id : null,
    industryId: typeof record.industry_id === "string" ? record.industry_id : null,
    industryName: industryRecord && typeof industryRecord.name === "string" ? industryRecord.name : null,
    avatarPath: typeof record.avatar_path === "string" && record.avatar_path ? record.avatar_path : null,
    inventoryMarkup: readInventoryMarkup(record.inventory_markup),
    role: typeof membership.role === "string" ? membership.role : "member",
  };
}

export function workspaceUpdateFields(input: { name: string; industryId: string; inventoryMarkup: number }) {
  const name = input.name.trim();
  if (!name) throw new Error("Company name is required");

  const industryId = input.industryId.trim();
  if (!industryId) throw new Error("Business type is required");

  const inventoryMarkup = input.inventoryMarkup;
  if (!Number.isFinite(inventoryMarkup)) throw new Error("Markup percentage must be a number");
  if (inventoryMarkup < 0) throw new Error("Markup percentage cannot be negative");
  if (inventoryMarkup > 1000) throw new Error("Markup percentage cannot be greater than 1000");

  return { name, industryId, inventoryMarkup };
}

async function currentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");
  return user;
}

async function requireWorkspaceMembership(userId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this workspace");

  return data;
}

export async function getWorkspace(workspaceId: string) {
  if (!workspaceId) return null;

  const user = await currentUser();
  const data = await selectMembership(
    (select) =>
      supabase.from("workspace_members").select(select).eq("user_id", user.id).eq("workspace_id", workspaceId).is("deleted_at", null).is("workspaces.deleted_at", null).maybeSingle() as unknown as PromiseLike<MembershipResult>,
  );

  return toWorkspaceDetails(data);
}

export async function updateWorkspaceDetails(workspaceId: string, input: { name: string; industryId: string; inventoryMarkup: number }) {
  const fields = workspaceUpdateFields(input);
  const user = await currentUser();
  await requireWorkspaceMembership(user.id, workspaceId);

  const resolvedIndustryId = await resolveIndustryId(fields.industryId);
  const { data, error } = await supabase
    .from("workspaces")
    .update({ name: fields.name, industry_id: resolvedIndustryId, inventory_markup: fields.inventoryMarkup })
    .eq("id", workspaceId)
    .select("id, name, industry_id, inventory_markup")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Workspace was not updated");

  return {
    id: String(data.id),
    name: typeof data.name === "string" ? data.name : fields.name,
    industryId: typeof data.industry_id === "string" ? data.industry_id : resolvedIndustryId,
    inventoryMarkup: readInventoryMarkup(data.inventory_markup) ?? fields.inventoryMarkup,
  };
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
