import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { INDUSTRY_ID, PASSWORD, USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

function clientRequestsFor(workspaceId: string) {
  return fake.requests.filter((request) => request.table === "clients" && request.filters.includes(`workspace_id=eq.${workspaceId}`));
}

describe("login", () => {
  it("logs in and lands on the active workspace dashboard with its data", async () => {
    const { user, location } = renderApp("/en/login");

    await user.type(await screen.findByLabelText("Email"), USERS.owner.email);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.A}/dashboard`));
    expect(await screen.findByText("Alpha Garage car")).toBeInTheDocument();
    expect(screen.queryByText("Beta Service car")).not.toBeInTheDocument();
  });

  it("shows an error for wrong credentials and stays on the login page", async () => {
    const { user, location } = renderApp("/en/login");

    await user.type(await screen.findByLabelText("Email"), USERS.owner.email);
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid login or password")).toBeInTheDocument();
    expect(location.pathname).toBe("/en/login");
    expect(fake.uid).toBeNull();
  });

  it("validates the login form before calling Supabase", async () => {
    const { user } = renderApp("/en/login");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Invalid email format")).toBeInTheDocument();
    expect(await screen.findByText("Password is required")).toBeInTheDocument();
  });

  it("redirects a signed-out visitor from a protected page to login", async () => {
    const { location } = renderApp(`/en/${WS.A}/clients`);
    await waitFor(() => expect(location.pathname).toBe("/en/login"));
    expect(clientRequestsFor(WS.A)).toHaveLength(0);
  });

  it("redirects a signed-in user away from the login page", async () => {
    fake.signInAs(USERS.member.id);
    const { location } = renderApp("/en/login");
    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.A}/dashboard`));
  });

  it("logs out from the user menu, clears cached data and returns to login", async () => {
    fake.signInAs(USERS.owner.id);
    const { user, location, queryClient } = renderApp(`/en/${WS.A}/clients`);
    await screen.findByText("Ada Alpha");
    window.history.pushState({}, "", `/en/${WS.A}/clients`);

    await user.click(screen.getByRole("button", { name: "OO" }));
    await user.click(await screen.findByRole("menuitem", { name: /Log out/ }));

    await waitFor(() => expect(location.pathname).toBe("/en/login"));
    expect(fake.uid).toBeNull();
    expect(queryClient.getQueryCache().findAll({ queryKey: ["clients"] }).filter((query) => query.state.data !== undefined)).toHaveLength(0);
  });
});

describe("workspace routing and switching", () => {
  it("sends a URL for a workspace the user does not belong to back to the active workspace", async () => {
    fake.signInAs(USERS.owner.id);
    const { location } = renderApp(`/en/${WS.C}/clients`);

    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.A}/clients`));
    expect(await screen.findByText("Ada Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Gus Gamma")).not.toBeInTheDocument();
    expect(clientRequestsFor(WS.C)).toHaveLength(0);
  });

  it("does not follow a URL to another workspace the user belongs to without switching the active workspace", async () => {
    fake.signInAs(USERS.owner.id);
    const { location } = renderApp(`/en/${WS.B}/clients`);
    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.A}/clients`));
    expect(await screen.findByText("Ada Alpha")).toBeInTheDocument();
    expect(row("profiles", USERS.owner.id)?.active_workspace_id).toBe(WS.A);
  });

  it("repairs a stale active workspace from /dashboard", async () => {
    fake.signInAs(USERS.member.id);
    row("profiles", USERS.member.id)!.active_workspace_id = WS.C;
    const { location } = renderApp("/en/dashboard");
    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.A}/dashboard`));
    expect(row("profiles", USERS.member.id)?.active_workspace_id).toBe(WS.A);
  });

  it("tells a user without workspaces that they have none", async () => {
    fake.signInAs(USERS.newbie.id);
    renderApp("/en/dashboard");
    expect(await screen.findByText("You are not a member of any workspace yet.")).toBeInTheDocument();
  });

  it("switches workspace from the company selector and shows only the new workspace's data on every page", async () => {
    fake.signInAs(USERS.owner.id);
    const { user, location } = renderApp(`/en/${WS.A}/clients`);
    await screen.findByText("Ada Alpha");

    await user.click(screen.getByRole("button", { name: /Alpha Garage/ }));
    await user.click(await screen.findByText("Beta Service", { selector: "span" }));

    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.B}/clients`));
    expect(await screen.findByText("Bob Beta")).toBeInTheDocument();
    expect(screen.queryByText("Ada Alpha")).not.toBeInTheDocument();
    expect(row("profiles", USERS.owner.id)?.active_workspace_id).toBe(WS.B);

    const pages: [string, string, string][] = [
      ["Orders", "Beta Service car", "Alpha Garage car"],
      ["Services", "Beta wash", "Oil change"],
      ["Inventory", "Beta filter", "Alpha brake pads"],
      ["Employees", "Bert Beta", "Tom Tech"],
    ];
    for (const [page, visible, hidden] of pages) {
      await user.click(within(screen.getByRole("navigation")).getByRole("button", { name: page }));
      await waitFor(() => expect(location.pathname).toBe(`/en/${WS.B}/${page.toLowerCase()}`));
      expect(await screen.findByText(visible)).toBeInTheDocument();
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
  });

  it("deletes a workspace from the company selector, moving the owner to the remaining one", async () => {
    fake.signInAs(USERS.owner.id);
    const { user, location } = renderApp(`/en/${WS.A}/clients`);
    await screen.findByText("Ada Alpha");

    await user.click(screen.getByRole("button", { name: /Alpha Garage/ }));
    await user.click(await screen.findByLabelText("Delete Alpha Garage"));

    await waitFor(() => expect(location.pathname).toBe(`/en/${WS.B}/clients`));
    expect(await screen.findByText("Bob Beta")).toBeInTheDocument();
    expect(row("workspaces", WS.A)?.deleted_at).toBeTruthy();
    expect(await screen.findByText("Workspace was deleted!")).toBeInTheDocument();
  });

  it("does not offer workspace deletion to a non-owner", async () => {
    fake.signInAs(USERS.admin.id);
    const { user } = renderApp(`/en/${WS.A}/clients`);
    await screen.findByText("Ada Alpha");
    await user.click(screen.getByRole("button", { name: /Alpha Garage/ }));
    await screen.findByText("Switch Company");
    expect(screen.queryByLabelText("Delete Alpha Garage")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete Beta Service")).not.toBeInTheDocument();
  });
});

describe("add workspace", () => {
  async function openAddWorkspace() {
    fake.signInAs(USERS.member.id);
    const app = renderApp(`/en/${WS.A}/clients`);
    await screen.findByText("Ada Alpha");
    await app.user.click(screen.getByRole("button", { name: /Alpha Garage/ }));
    await app.user.click(await screen.findByText("+ Add company"));
    const dialog = await screen.findByRole("dialog", { name: "Add New Workspace" });
    await app.user.type(within(dialog).getByLabelText("Workspace *"), "Max Garage");
    await app.user.click(within(dialog).getByRole("combobox"));
    await app.user.click(await screen.findByRole("option", { name: "Auto Repair & Service" }));
    await app.user.type(within(dialog).getByLabelText("Role *"), "Owner");
    return { ...app, dialog };
  }

  it("creates a workspace owned by the signed-in user and closes the dialog", async () => {
    const { user, dialog } = await openAddWorkspace();
    await user.click(within(dialog).getByRole("button", { name: "Add Company" }));

    expect(await screen.findByText("Workspace was created!")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add New Workspace" })).not.toBeInTheDocument());
    const created = fake.all("workspaces").find((workspace) => workspace.name === "Max Garage");
    expect(created).toMatchObject({ owner_id: USERS.member.id, industry_id: INDUSTRY_ID });
    expect(fake.all("workspace_members").find((member) => member.workspace_id === created?.id)).toMatchObject({ user_id: USERS.member.id, role: "owner" });
  });

  it("keeps the dialog open and reports the error when the insert is rejected", async () => {
    const unhandled = trackUnhandledRejections();
    const { user, dialog } = await openAddWorkspace();
    fake.failNext("workspaces", "insert", { code: "42501", message: 'new row violates row-level security policy for table "workspaces"' });

    await user.click(within(dialog).getByRole("button", { name: "Add Company" }));

    expect(await screen.findByText('new row violates row-level security policy for table "workspaces"')).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add New Workspace" })).toBeInTheDocument();
    expect(fake.all("workspaces").some((workspace) => workspace.name === "Max Garage")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    unhandled.stop();
    expect(unhandled.rejections).toEqual([]);
  });

  it("closes the dialog on Cancel without creating anything", async () => {
    const { user, dialog } = await openAddWorkspace();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add New Workspace" })).not.toBeInTheDocument());
    expect(fake.all("workspaces").some((workspace) => workspace.name === "Max Garage")).toBe(false);
  });
});
