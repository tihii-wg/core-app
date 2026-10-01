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
  role?: string | null;
  workspaces: ListedWorkspace | ListedWorkspace[] | null;
};

const ownerOnlyWorkspaceMessage = "Only the workspace owner can change company settings.";

export async function getUserWorkspaces() {
  const user = await currentUser();

  const data = await selectMembership(
    (select) => supabase.from("workspace_members").select(select).eq("user_id", user.id).is("deleted_at", null).is("workspaces.deleted_at", null) as unknown as PromiseLike<MembershipResult>,
  );

  return (Array.isArray(data) ? data : []) as ListedWorkspaceMembership[];
}

const preferenceColumns = ["language", "timezone", "date_format", "currency"] as const;

function mentionsPreferenceColumn(message?: string) {
  return preferenceColumns.some((column) => message?.includes(column) === true);
}

function membershipSelect(options: { industry: boolean; avatar: boolean; markup: boolean; preferences: boolean }) {
  const fields = ["id", "name", "owner_id", "deleted_at", "industry_id"];
  if (options.avatar) fields.push("avatar_path");
  if (options.markup) fields.push("inventory_markup");
  if (options.preferences) fields.push(...preferenceColumns);
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
  if (error.message?.includes("avatar_path") || error.message?.includes("inventory_markup") || mentionsPreferenceColumn(error.message)) return false;
  return error.code === "PGRST205" || error.code === "PGRST200" || error.code === "42703" || error.message?.includes("industries") === true;
}

function isMissingPreferenceColumn(error: { code?: string; message?: string }) {
  return (error.code === "42703" || error.code === "PGRST204") && mentionsPreferenceColumn(error.message);
}

function isMissingMarkupColumn(error: { code?: string; message?: string }) {
  return (error.code === "42703" || error.code === "PGRST204") && error.message?.includes("inventory_markup") === true;
}

async function selectMembership(run: (select: string) => PromiseLike<MembershipResult>) {
  let industry = true;
  let avatar = true;
  let markup = true;
  let preferences = true;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await run(membershipSelect({ industry, avatar, markup, preferences }));
    if (!error) return data;
    if (preferences && isMissingPreferenceColumn(error)) {
      preferences = false;
      continue;
    }
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
  language: string | null;
  timezone: string | null;
  dateFormat: string | null;
  currency: string | null;
  role: string;
};

function firstRecord(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    language: readText(record.language),
    timezone: readText(record.timezone),
    dateFormat: readText(record.date_format),
    currency: readText(record.currency),
    role: typeof membership.role === "string" ? membership.role : "member",
  };
}

export type WorkspacePreferencesInput = {
  language: string;
  timezone: string;
  dateFormat: string;
  currency: string;
};

const workspaceLanguages = ["en", "ro", "ru"] as const;

export type WorkspaceLanguage = (typeof workspaceLanguages)[number];

export function normalizeWorkspaceLanguage(value: string | null | undefined): WorkspaceLanguage {
  const code = value?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if ((workspaceLanguages as readonly string[]).includes(code)) return code as WorkspaceLanguage;
  return "en";
}

const workspaceDateFormats = ["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;

export type WorkspaceDateFormat = (typeof workspaceDateFormats)[number];

const dateFormatAliases: Record<string, WorkspaceDateFormat> = {
  "dd.mm.yyyy": "DD.MM.YYYY",
  "dd/mm/yyyy": "DD.MM.YYYY",
  "mm/dd/yyyy": "MM/DD/YYYY",
  "yyyy-mm-dd": "YYYY-MM-DD",
};

export function normalizeWorkspaceDateFormat(value: string | null | undefined): WorkspaceDateFormat {
  const format = value?.trim() ?? "";
  if ((workspaceDateFormats as readonly string[]).includes(format)) return format as WorkspaceDateFormat;
  return dateFormatAliases[format.toLowerCase()] ?? "DD.MM.YYYY";
}

export function workspacePreferenceFields(input: WorkspacePreferencesInput) {
  const timezone = input.timezone.trim();
  const currency = input.currency.trim();
  if (!timezone) throw new Error("Time zone is required");
  if (!currency) throw new Error("Currency is required");
  return {
    language: normalizeWorkspaceLanguage(input.language),
    timezone,
    date_format: normalizeWorkspaceDateFormat(input.dateFormat),
    currency,
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
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error(error.message);
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

export type WorkspaceTeamMember = {
  userId: string;
  role: string;
  createdAt: string | null;
  fullName: string | null;
  email: string | null;
  isCurrentUser: boolean;
};

type TeamProfileRow = { user_id: string; full_name: string | null; email: string | null };
type TeamMemberRow = { user_id: string; role: string | null; created_at?: string | null; deleted_at?: string | null };

const teamRoleOrder = ["owner", "admin", "manager", "member"];
const teamMigrationMessage = "Team member management needs the latest database update (supabase/migrations/20260929000300_team_member_rpcs.sql).";

function isMissingFunction(error: { code?: string; message?: string }) {
  return error.code === "PGRST202" || error.code === "42883";
}

function isPermissionError(error: { code?: string; message?: string }) {
  return error.code === "42501" || error.message?.toLowerCase().includes("row-level security") === true;
}

function teamMemberError(error: { code?: string; message?: string }, permissionMessage: string) {
  if (isMissingFunction(error)) return new Error(teamMigrationMessage);
  if (isPermissionError(error)) return new Error(permissionMessage);
  return new Error(error.message ?? permissionMessage);
}

export function assignableTeamRole(role: string) {
  const value = role.trim().toLowerCase();
  if (value !== "admin" && value !== "manager" && value !== "member") throw new Error("Choose admin, manager, or member");
  return value;
}

async function readTeamProfiles(workspaceId: string, userId: string) {
  const { data, error } = await supabase.rpc("workspace_member_profiles", { target_workspace: workspaceId });
  if (!error) return (data ?? []) as TeamProfileRow[];
  if (!isMissingFunction(error)) throw new Error(error.message);

  const { data: own, error: ownError } = await supabase.from("profiles").select("id, full_name, email").eq("id", userId).maybeSingle();
  if (ownError) throw new Error(ownError.message);
  return own ? [{ user_id: String(own.id), full_name: own.full_name ?? null, email: own.email ?? null }] : [];
}

export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceTeamMember[]> {
  const user = await currentUser();
  await requireWorkspaceMembership(user.id, workspaceId);

  const [{ data: members, error }, profiles] = await Promise.all([
    supabase.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspaceId).is("deleted_at", null),
    readTeamProfiles(workspaceId, user.id),
  ]);
  if (error) throw new Error(error.message);

  const profilesById = new Map(profiles.map((profile) => [profile.user_id, profile]));
  const rank = (role: string) => {
    const index = teamRoleOrder.indexOf(role);
    return index === -1 ? teamRoleOrder.length : index;
  };

  return ((members ?? []) as TeamMemberRow[])
    .map((row) => {
      const profile = profilesById.get(row.user_id);
      const isCurrentUser = row.user_id === user.id;
      return {
        userId: row.user_id,
        role: row.role ?? "member",
        createdAt: row.created_at ?? null,
        fullName: profile?.full_name ?? null,
        email: profile?.email ?? (isCurrentUser ? (user.email ?? null) : null),
        isCurrentUser,
      };
    })
    .sort((a, b) => rank(a.role) - rank(b.role) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export async function addWorkspaceMember(workspaceId: string, input: { email: string; role: string }) {
  const role = assignableTeamRole(input.role);
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("Email is required");

  const user = await currentUser();
  await requireWorkspaceMembership(user.id, workspaceId);

  const { data: userId, error: lookupError } = await supabase.rpc("workspace_member_find_user", { target_workspace: workspaceId, member_email: email });
  if (lookupError) throw teamMemberError(lookupError, "You do not have permission to add team members");
  if (!userId) throw new Error("No Core App account uses this email. Ask them to sign up first.");
  if (userId === user.id) throw new Error("You are already a member of this workspace");

  const { data: existingRows, error: existingError } = await supabase.from("workspace_members").select("user_id, role, deleted_at").eq("workspace_id", workspaceId).eq("user_id", userId);
  if (existingError) throw new Error(existingError.message);

  const existing = (existingRows ?? []) as TeamMemberRow[];
  if (existing.some((row) => !row.deleted_at)) throw new Error("This user is already a team member");

  const permissionMessage = "You do not have permission to add this team member";

  if (existing.length > 0) {
    const { data, error } = await supabase
      .from("workspace_members")
      .update({ role, deleted_at: null })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .select("user_id")
      .limit(1);
    if (error) throw teamMemberError(error, permissionMessage);
    if (!data || data.length === 0) throw new Error(permissionMessage);
    return { userId: String(userId), role };
  }

  const { error } = await supabase.from("workspace_members").insert([{ workspace_id: workspaceId, user_id: userId, role }]);
  if (error) throw teamMemberError(error, permissionMessage);
  return { userId: String(userId), role };
}

export async function updateWorkspaceMemberRole(workspaceId: string, userId: string, nextRole: string) {
  const role = assignableTeamRole(nextRole);
  const permissionMessage = "You do not have permission to change this member's role";

  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("user_id, role");
  if (error) throw teamMemberError(error, permissionMessage);
  if (!data || data.length === 0) throw new Error(permissionMessage);
  return { userId, role };
}

export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  const permissionMessage = "You do not have permission to remove this member";

  const { data, error } = await supabase
    .from("workspace_members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("user_id");
  if (error) throw teamMemberError(error, permissionMessage);
  if (!data || data.length === 0) throw new Error(permissionMessage);
  return { userId };
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
  if (!data) throw new Error(ownerOnlyWorkspaceMessage);

  return {
    id: String(data.id),
    name: typeof data.name === "string" ? data.name : fields.name,
    industryId: typeof data.industry_id === "string" ? data.industry_id : resolvedIndustryId,
    inventoryMarkup: readInventoryMarkup(data.inventory_markup) ?? fields.inventoryMarkup,
  };
}

export async function updateWorkspacePreferences(workspaceId: string, input: WorkspacePreferencesInput) {
  const fields = workspacePreferenceFields(input);
  const user = await currentUser();
  await requireWorkspaceMembership(user.id, workspaceId);

  const { data, error } = await supabase.from("workspaces").update(fields).eq("id", workspaceId).is("deleted_at", null).select("id").maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(ownerOnlyWorkspaceMessage);

  return getWorkspace(workspaceId);
}

export async function setActiveWorkspace(id: string) {
  const user = await currentUser();

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
  const user = await currentUser();
  const industryId = await resolveIndustryId(newWorkspaceData.industryId);

  const { data, error } = await supabase
    .from("workspaces")
    .insert([
      {
        name: newWorkspaceData.name,
        owner_id: user.id,
        industry_id: industryId,
        language: normalizeWorkspaceLanguage(newWorkspaceData.language),
        date_format: normalizeWorkspaceDateFormat("DD.MM.YYYY"),
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
        role: "owner",
        user_id: user.id,
      },
    ])
    .select();
  if (error2) throw new Error(error2.message);

  return data;
}

export async function deleteWorkspace(workspaceId: string) {
  const user = await currentUser();

  const { data: memberships, error: membershipsError } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces!inner(id)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .is("workspaces.deleted_at", null);

  if (membershipsError) throw new Error(membershipsError.message);

  const workspaceIds = (memberships ?? []).map((membership) => String(membership.workspace_id));
  if (workspaceIds.length <= 1) throw new Error("You cannot delete last workspace");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error("Profile not found");

  // Owner-only; soft-deletes the workspace and all of its memberships in one transaction.
  const { error: softDeleteError } = await supabase.rpc("soft_delete_workspace", { target_workspace: workspaceId });

  if (softDeleteError) {
    if (isMissingFunction(softDeleteError)) throw new Error("Workspace deletion needs the latest database update (public.soft_delete_workspace).");
    throw new Error(softDeleteError.message);
  }

  let nextWorkspaceId: string | null = profile.active_workspace_id;

  if (nextWorkspaceId === workspaceId) {
    nextWorkspaceId = workspaceIds.find((id) => id !== workspaceId) ?? null;

    if (nextWorkspaceId) {
      const { error: switchError } = await supabase.from("profiles").update({ active_workspace_id: nextWorkspaceId }).eq("id", user.id);
      if (switchError) throw new Error(`The workspace was deleted, but switching to another workspace failed: ${switchError.message}`);
    }
  }

  return { deleteWorkspace: [{ id: workspaceId }], nextWorkspaceId };
}
