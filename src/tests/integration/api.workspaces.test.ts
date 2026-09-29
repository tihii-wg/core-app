import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWorkspaceMember,
  createWorkspace,
  deleteWorkspace,
  getUserWorkspaces,
  getWorkspace,
  getWorkspaceMembers,
  removeWorkspaceMember,
  setActiveWorkspace,
  updateWorkspaceDetails,
  updateWorkspaceMemberRole,
  updateWorkspacePreferences,
} from "../../services/apiWorkspaces";
import { getWorkspaceLogoUrl, removeWorkspaceLogo, uploadWorkspaceLogo } from "../../features/workspaces/workspaceAvatar";
import { fake } from "../fakeSupabase";
import { INDUSTRY_ID, USERS, WS, membership, row, seedCoreApp } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

beforeEach(() => {
  seedCoreApp();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

function workspaceNames(memberships: Awaited<ReturnType<typeof getUserWorkspaces>>) {
  return memberships.map((item) => (Array.isArray(item.workspaces) ? item.workspaces[0]?.name : item.workspaces?.name)).sort();
}

describe("workspace list and details", () => {
  it("lists only the caller's active memberships with their role", async () => {
    fake.signInAs(USERS.admin.id);
    const memberships = await getUserWorkspaces();
    expect(workspaceNames(memberships)).toEqual(["Alpha Garage", "Beta Service"]);
    expect(memberships.map((item) => item.role).sort()).toEqual(["admin", "member"]);

    fake.signInAs(USERS.newbie.id);
    expect(await getUserWorkspaces()).toEqual([]);
  });

  it("drops soft-deleted workspaces and removed memberships", async () => {
    row("workspaces", WS.B)!.deleted_at = "2026-09-01T00:00:00.000Z";
    membership(WS.A, USERS.admin.id)!.deleted_at = "2026-09-01T00:00:00.000Z";
    fake.signInAs(USERS.admin.id);
    expect(await getUserWorkspaces()).toEqual([]);
  });

  it("requires a session", async () => {
    await expect(getUserWorkspaces()).rejects.toThrow("Auth session missing!");
  });

  it("returns workspace details with industry and the caller's role", async () => {
    fake.signInAs(USERS.manager.id);
    expect(await getWorkspace(WS.A)).toMatchObject({ id: WS.A, name: "Alpha Garage", role: "manager", industryName: "Auto Repair & Service", inventoryMarkup: 20, currency: "MDL", ownerId: USERS.owner.id });
  });

  it("returns null for a workspace the caller is not in, a deleted one, or an empty id", async () => {
    fake.signInAs(USERS.manager.id);
    expect(await getWorkspace(WS.C)).toBeNull();
    expect(await getWorkspace("")).toBeNull();
    row("workspaces", WS.A)!.deleted_at = "2026-09-01T00:00:00.000Z";
    expect(await getWorkspace(WS.A)).toBeNull();
  });

  it("falls back to a smaller select when optional columns are missing", async () => {
    fake.signInAs(USERS.owner.id);
    fake.failNext("workspace_members", "select", { code: "42703", message: "column workspaces_1.avatar_path does not exist" });
    expect(await getWorkspace(WS.A)).toMatchObject({ id: WS.A, avatarPath: null });
  });
});

describe("company settings", () => {
  it("lets the owner update details and preferences", async () => {
    fake.signInAs(USERS.owner.id);
    expect(await updateWorkspaceDetails(WS.A, { name: " Alpha 2 ", industryId: "auto_repair", inventoryMarkup: 15 })).toEqual({ id: WS.A, name: "Alpha 2", industryId: INDUSTRY_ID, inventoryMarkup: 15 });
    expect(await updateWorkspacePreferences(WS.A, { language: "ro-RO", timezone: "Europe/Bucharest", dateFormat: "yyyy-mm-dd", currency: "EUR" })).toMatchObject({ language: "ro", dateFormat: "YYYY-MM-DD", currency: "EUR" });
  });

  it.each([USERS.admin, USERS.manager, USERS.member])("refuses $email and keeps the workspace unchanged", async (user) => {
    fake.signInAs(user.id);
    await expect(updateWorkspaceDetails(WS.A, { name: "Hijack", industryId: INDUSTRY_ID, inventoryMarkup: 1 })).rejects.toThrow("Only the workspace owner can change company settings.");
    await expect(updateWorkspacePreferences(WS.A, { language: "en", timezone: "UTC", dateFormat: "DD.MM.YYYY", currency: "USD" })).rejects.toThrow("Only the workspace owner can change company settings.");
    expect(row("workspaces", WS.A)).toMatchObject({ name: "Alpha Garage", currency: "MDL" });
  });

  it("refuses non-members before writing and validates the input", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(updateWorkspaceDetails(WS.C, { name: "X", industryId: INDUSTRY_ID, inventoryMarkup: 1 })).rejects.toThrow("You do not have access to this workspace");
    await expect(updateWorkspaceDetails(WS.A, { name: " ", industryId: INDUSTRY_ID, inventoryMarkup: 1 })).rejects.toThrow("Company name is required");
    await expect(updateWorkspaceDetails(WS.A, { name: "X", industryId: "unknown", inventoryMarkup: 1 })).rejects.toThrow("Selected business type was not found");
    await expect(updateWorkspacePreferences(WS.A, { language: "en", timezone: " ", dateFormat: "", currency: "USD" })).rejects.toThrow("Time zone is required");
  });
});

describe("active workspace", () => {
  it("switches the profile's active workspace to a workspace the user belongs to", async () => {
    fake.signInAs(USERS.admin.id);
    expect(await setActiveWorkspace(WS.B)).toBe(WS.B);
    expect(row("profiles", USERS.admin.id)?.active_workspace_id).toBe(WS.B);
  });

  it("refuses a workspace the user does not belong to and leaves the profile alone", async () => {
    fake.signInAs(USERS.member.id);
    await expect(setActiveWorkspace(WS.C)).rejects.toThrow("You do not have access to this workspace");
    expect(row("profiles", USERS.member.id)?.active_workspace_id).toBe(WS.A);
  });
});

describe("create and delete workspaces", () => {
  it("creates a workspace with the caller as its bootstrap owner", async () => {
    fake.signInAs(USERS.newbie.id);
    const [created] = await createWorkspace({ name: "Nina Repairs", role: "owner", industryId: "auto_repair", language: "ru" });
    expect(created).toMatchObject({ owner_id: USERS.newbie.id, language: "ru", industry_id: INDUSTRY_ID });
    expect(membership(String(created.id), USERS.newbie.id)).toMatchObject({ role: "owner", deleted_at: null });
  });

  it("does not let a user claim ownership of an existing workspace through a membership insert", async () => {
    fake.signInAs(USERS.newbie.id);
    const { error } = await fake.client.from("workspace_members").insert([{ workspace_id: WS.C, user_id: USERS.newbie.id, role: "owner" }]);
    expect(error?.code).toBe("42501");
    expect(membership(WS.C, USERS.newbie.id)).toBeUndefined();
  });

  it("soft-deletes an owned workspace with its memberships and moves the active workspace", async () => {
    fake.signInAs(USERS.owner.id);
    expect(await deleteWorkspace(WS.A)).toEqual({ deleteWorkspace: [{ id: WS.A }], nextWorkspaceId: WS.B });
    expect(row("workspaces", WS.A)?.deleted_at).toBeTruthy();
    expect(fake.all("workspace_members").filter((item) => item.workspace_id === WS.A).every((item) => item.deleted_at)).toBe(true);
    expect(row("profiles", USERS.owner.id)?.active_workspace_id).toBe(WS.B);
    expect(fake.all("workspaces")).toHaveLength(3);
  });

  it("refuses deleting the last workspace", async () => {
    fake.signInAs(USERS.outsider.id);
    await expect(deleteWorkspace(WS.C)).rejects.toThrow("You cannot delete last workspace");
    expect(row("workspaces", WS.C)?.deleted_at).toBeNull();
  });

  it("refuses a non-owner even when they belong to several workspaces", async () => {
    fake.signInAs(USERS.admin.id);
    await expect(deleteWorkspace(WS.A)).rejects.toThrow("Only the workspace owner can delete this workspace");
    expect(row("workspaces", WS.A)?.deleted_at).toBeNull();
  });

  it("explains a missing soft_delete_workspace function", async () => {
    fake.signInAs(USERS.owner.id);
    delete fake.rpcs.soft_delete_workspace;
    await expect(deleteWorkspace(WS.B)).rejects.toThrow("Workspace deletion needs the latest database update (public.soft_delete_workspace).");
  });
});

describe("team members", () => {
  it("lists active members with profiles, ordered by role, for any member", async () => {
    fake.signInAs(USERS.member.id);
    const members = await getWorkspaceMembers(WS.A);
    expect(members.map((item) => [item.role, item.fullName, item.isCurrentUser])).toEqual([
      ["owner", "Olga Owner", false],
      ["admin", "Adam Admin", false],
      ["manager", "Mia Manager", false],
      ["member", "Max Member", true],
    ]);
  });

  it("refuses listing a workspace the caller does not belong to", async () => {
    fake.signInAs(USERS.member.id);
    await expect(getWorkspaceMembers(WS.C)).rejects.toThrow("You do not have access to this workspace");
  });

  it("lets the owner add an existing account by email", async () => {
    fake.signInAs(USERS.owner.id);
    expect(await addWorkspaceMember(WS.A, { email: " NEWBIE@example.com ", role: "manager" })).toEqual({ userId: USERS.newbie.id, role: "manager" });
    expect(membership(WS.A, USERS.newbie.id)).toMatchObject({ role: "manager", deleted_at: null });
  });

  it("restores a previously removed member instead of inserting a duplicate", async () => {
    fake.signInAs(USERS.owner.id);
    await removeWorkspaceMember(WS.A, USERS.member.id);
    await addWorkspaceMember(WS.A, { email: USERS.member.email, role: "manager" });
    const rows = fake.all("workspace_members").filter((item) => item.workspace_id === WS.A && item.user_id === USERS.member.id);
    expect(rows).toEqual([expect.objectContaining({ role: "manager", deleted_at: null })]);
  });

  it("explains unknown emails, self-adds and existing members", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(addWorkspaceMember(WS.A, { email: "ghost@example.com", role: "member" })).rejects.toThrow("No Core App account uses this email. Ask them to sign up first.");
    await expect(addWorkspaceMember(WS.A, { email: USERS.owner.email, role: "member" })).rejects.toThrow("You are already a member of this workspace");
    await expect(addWorkspaceMember(WS.A, { email: USERS.member.email, role: "member" })).rejects.toThrow("This user is already a team member");
  });

  it("does not allow assigning the owner role or unknown roles", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(addWorkspaceMember(WS.A, { email: USERS.newbie.email, role: "owner" })).rejects.toThrow("Choose admin, manager, or member");
    await expect(updateWorkspaceMemberRole(WS.A, USERS.member.id, "superuser")).rejects.toThrow("Choose admin, manager, or member");
  });

  it("lets an admin add managers and members but not admins", async () => {
    fake.signInAs(USERS.admin.id);
    await expect(addWorkspaceMember(WS.A, { email: USERS.newbie.email, role: "admin" })).rejects.toThrow("You do not have permission to add this team member");
    await expect(addWorkspaceMember(WS.A, { email: USERS.newbie.email, role: "member" })).resolves.toEqual({ userId: USERS.newbie.id, role: "member" });
  });

  it.each([USERS.manager, USERS.member])("refuses $email adding members", async (user) => {
    fake.signInAs(user.id);
    await expect(addWorkspaceMember(WS.A, { email: USERS.newbie.email, role: "member" })).rejects.toThrow("You do not have permission to add team members");
    expect(membership(WS.A, USERS.newbie.id)).toBeUndefined();
  });

  it("changes roles within the caller's authority", async () => {
    fake.signInAs(USERS.owner.id);
    await updateWorkspaceMemberRole(WS.A, USERS.member.id, "admin");
    expect(membership(WS.A, USERS.member.id)?.role).toBe("admin");

    fake.signInAs(USERS.admin.id);
    await expect(updateWorkspaceMemberRole(WS.A, USERS.member.id, "member")).rejects.toThrow("You do not have permission to change this member's role");
    await expect(updateWorkspaceMemberRole(WS.A, USERS.owner.id, "member")).rejects.toThrow("You do not have permission to change this member's role");
    await expect(updateWorkspaceMemberRole(WS.A, USERS.admin.id, "manager")).rejects.toThrow("You do not have permission to change this member's role");
    expect(membership(WS.A, USERS.owner.id)?.role).toBe("owner");
  });

  it("soft-removes members within the caller's authority and never removes the owner", async () => {
    fake.signInAs(USERS.admin.id);
    await removeWorkspaceMember(WS.A, USERS.member.id);
    expect(membership(WS.A, USERS.member.id)?.deleted_at).toBeTruthy();
    await expect(removeWorkspaceMember(WS.A, USERS.owner.id)).rejects.toThrow("You do not have permission to remove this member");

    fake.signInAs(USERS.manager.id);
    await expect(removeWorkspaceMember(WS.A, USERS.admin.id)).rejects.toThrow("You do not have permission to remove this member");
    expect(membership(WS.A, USERS.owner.id)?.deleted_at).toBeNull();
    expect(membership(WS.A, USERS.admin.id)?.deleted_at).toBeNull();
  });

  it("a removed member loses access to the workspace data", async () => {
    fake.signInAs(USERS.owner.id);
    await removeWorkspaceMember(WS.A, USERS.member.id);
    fake.signInAs(USERS.member.id);
    const { data } = await fake.client.from("clients").select("name").eq("workspace_id", WS.A);
    expect(data).toEqual([]);
    await expect(getWorkspaceMembers(WS.A)).rejects.toThrow("You do not have access to this workspace");
  });

  it("explains a missing team migration", async () => {
    fake.signInAs(USERS.owner.id);
    delete fake.rpcs.workspace_member_find_user;
    await expect(addWorkspaceMember(WS.A, { email: USERS.newbie.email, role: "member" })).rejects.toThrow(/20260928200000_team_members_rls\.sql/);
  });
});

describe("company logo", () => {
  const logo = new Blob(["img"], { type: "image/webp" });

  it("uploads, signs and removes the owner's logo", async () => {
    fake.signInAs(USERS.owner.id);
    expect(await uploadWorkspaceLogo(WS.A, logo)).toBe(`${WS.A}/logo.webp`);
    expect(row("workspaces", WS.A)?.avatar_path).toBe(`${WS.A}/logo.webp`);
    expect(await getWorkspaceLogoUrl(WS.A, `${WS.A}/logo.webp`)).toContain(`${WS.A}/logo.webp`);

    await removeWorkspaceLogo(WS.A, `${WS.A}/logo.webp`);
    expect(row("workspaces", WS.A)?.avatar_path).toBeNull();
    expect(fake.storageObjects.size).toBe(0);
  });

  it("refuses a workspace the user is not a member of", async () => {
    fake.signInAs(USERS.member.id);
    await expect(uploadWorkspaceLogo(WS.C, logo)).rejects.toThrow("You do not have access to this workspace");
    expect(fake.storageObjects.size).toBe(0);
  });

  it("rejects a logo path that belongs to another workspace", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(getWorkspaceLogoUrl(WS.A, `${WS.C}/logo.webp`)).rejects.toThrow("Unable to load company logo. Please try again.");
    expect(await getWorkspaceLogoUrl(WS.A, null)).toBeNull();
  });
});
