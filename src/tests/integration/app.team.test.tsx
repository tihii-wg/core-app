import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, membership, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openTeam(userId: string) {
  fake.signInAs(userId);
  const app = renderApp(`/en/${WS.A}/settings?tab=team`);
  await screen.findByText(USERS.manager.name);
  return app;
}

type User = ReturnType<typeof renderApp>["user"];

async function invite(user: User, email: string, role?: string) {
  await user.click(screen.getByRole("button", { name: "Invite Member" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Email"), email);
  if (role) {
    await user.click(within(dialog).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: role }));
  }
  await user.click(within(dialog).getByRole("button", { name: "Add member" }));
  return dialog;
}

describe("team members", () => {
  it("lists only active members of the active workspace with their roles", async () => {
    await openTeam(USERS.owner.id);
    for (const user of [USERS.owner, USERS.admin, USERS.manager, USERS.member]) expect(screen.getByText(user.name)).toBeInTheDocument();
    expect(screen.queryByText(USERS.outsider.name)).not.toBeInTheDocument();
    expect(screen.queryByText(USERS.newbie.name)).not.toBeInTheDocument();
  });

  it("lets the owner invite an existing account with a chosen role", async () => {
    const { user } = await openTeam(USERS.owner.id);
    await invite(user, USERS.newbie.email, "Manager");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(USERS.newbie.name)).toBeInTheDocument();
    expect(membership(WS.A, USERS.newbie.id)).toMatchObject({ role: "manager", deleted_at: null });
  });

  it.each([
    ["an unknown email", "ghost@example.com", "No Core App account uses this email. Ask them to sign up first."],
    ["an existing member", USERS.member.email, "This user is already a team member"],
    ["an email the pattern rejects", "name@host", "Enter a valid email address"],
  ])("keeps the invite dialog open for %s", async (_label, email, message) => {
    const { user } = await openTeam(USERS.owner.id);
    const dialog = await invite(user, email);

    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "workspace_members" && request.op === "insert")).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("lets the owner change a member's role", async () => {
    const { user } = await openTeam(USERS.owner.id);
    await user.click(screen.getByRole("combobox", { name: `Role for ${USERS.admin.name}` }));
    await user.click(await screen.findByRole("option", { name: "Member" }));

    await waitFor(() => expect(membership(WS.A, USERS.admin.id)?.role).toBe("member"));
    expect(await screen.findByText("Role updated")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: `Role for ${USERS.admin.name}` })).toHaveTextContent("Member"));
  });

  it("shows the database error and the unchanged role when the role update is rejected", async () => {
    const { user } = await openTeam(USERS.owner.id);
    fake.failNext("workspace_members", "update", { code: "42501", message: 'new row violates row-level security policy for table "workspace_members"' });

    await user.click(screen.getByRole("combobox", { name: `Role for ${USERS.admin.name}` }));
    await user.click(await screen.findByRole("option", { name: "Member" }));

    expect(await screen.findByText("You do not have permission to change this member's role")).toBeInTheDocument();
    expect(membership(WS.A, USERS.admin.id)?.role).toBe("admin");
    expect(screen.getByRole("combobox", { name: `Role for ${USERS.admin.name}` })).toHaveTextContent("Admin");
  });

  it("removes a member by soft-deleting the membership after confirmation", async () => {
    const { user } = await openTeam(USERS.owner.id);
    const memberRow = screen.getByText(USERS.member.name).closest("div.rounded-lg") as HTMLElement;
    await user.click(within(memberRow).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(`${USERS.member.name} will lose access to this workspace.`)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText(USERS.member.name)).not.toBeInTheDocument());
    expect(membership(WS.A, USERS.member.id)?.deleted_at).toEqual(expect.any(String));
    expect(fake.requests.some((request) => request.table === "workspace_members" && request.op === "delete")).toBe(false);
  });

  it("keeps the confirmation open when removal is refused", async () => {
    const { user } = await openTeam(USERS.owner.id);
    fake.failNext("workspace_members", "update", { code: "42501", message: "permission denied for table workspace_members" });
    const memberRow = screen.getByText(USERS.member.name).closest("div.rounded-lg") as HTMLElement;
    await user.click(within(memberRow).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("You do not have permission to remove this member")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(membership(WS.A, USERS.member.id)?.deleted_at).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("lets an admin manage only managers and members", async () => {
    const { user } = await openTeam(USERS.admin.id);

    expect(screen.queryByRole("combobox", { name: `Role for ${USERS.owner.name}` })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: `Role for ${USERS.manager.name}` })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: `Role for ${USERS.member.name}` }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Manager", "Member"]);
  });

  it.each([USERS.manager, USERS.member])("is read-only for $email", async (viewer) => {
    await openTeam(viewer.id);
    expect(screen.queryByRole("button", { name: "Invite Member" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});
