import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openEmployees() {
  fake.signInAs(USERS.owner.id);
  const app = renderApp(`/en/${WS.A}/employees`);
  await screen.findByText("Tom Tech");
  return app;
}

async function fillEmployee(user: ReturnType<typeof renderApp>["user"]) {
  await user.click(screen.getByRole("button", { name: /Add Employee/ }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Full Name *"), "Eve Electric");
  await user.type(within(dialog).getByLabelText("Email *"), "eve@example.com");
  await user.type(within(dialog).getByLabelText("Phone *"), "+37369111111");
  await user.click(within(dialog).getByRole("combobox", { name: "Role *" }));
  await user.click(await screen.findByRole("option", { name: "Technician" }));
  return dialog;
}

describe("employees page", () => {
  it("lists only employees of the active workspace", async () => {
    await openEmployees();
    expect(screen.getByText("Tina Tech")).toBeInTheDocument();
    expect(screen.queryByText("Bert Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Greg Gamma")).not.toBeInTheDocument();
  });

  it("creates an employee in the active workspace", async () => {
    const { user } = await openEmployees();
    const dialog = await fillEmployee(user);
    await user.click(within(dialog).getByRole("button", { name: "Add Employee" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Eve Electric")).toBeInTheDocument();
    expect(fake.all("employees").find((employee) => employee.name === "Eve Electric")).toMatchObject({ workspace_id: WS.A, role: "technician", status: "active", profile_id: null });
  });

  it("defaults the linked user to Not linked and never links the creator automatically", async () => {
    const { user } = await openEmployees();
    const dialog = await fillEmployee(user);
    expect(within(dialog).getByRole("combobox", { name: "Linked user" })).toHaveTextContent("Not linked");

    await user.click(within(dialog).getByRole("button", { name: "Add Employee" }));

    await waitFor(() => expect(fake.all("employees").some((employee) => employee.name === "Eve Electric")).toBe(true));
    expect(fake.all("employees").find((employee) => employee.name === "Eve Electric")?.profile_id).toBeNull();
    expect(fake.requests.find((request) => request.table === "employees" && request.op === "insert")?.values).toMatchObject([{ profile_id: null }]);
  });

  it("links the employee to the selected active workspace member", async () => {
    const { user } = await openEmployees();
    const dialog = await fillEmployee(user);
    await user.click(within(dialog).getByRole("combobox", { name: "Linked user" }));
    await user.click(await screen.findByRole("option", { name: "Adam Admin (Admin)" }));

    await user.click(within(dialog).getByRole("button", { name: "Add Employee" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.all("employees").find((employee) => employee.name === "Eve Electric")).toMatchObject({ workspace_id: WS.A, profile_id: USERS.admin.id });
  });

  it("offers only active workspace members that are not linked to another employee", async () => {
    fake.all("workspace_members").find((item) => item.workspace_id === WS.A && item.user_id === USERS.admin.id)!.deleted_at = "2026-09-01T00:00:00.000Z";
    const { user } = await openEmployees();
    await user.click(screen.getByRole("button", { name: /Add Employee/ }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("combobox", { name: "Linked user" }));
    await screen.findByRole("option", { name: "Olga Owner (Owner)" });

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Not linked", "Olga Owner (Owner)"]);
  });

  it("keeps the dialog open when the selected user is no longer a workspace member", async () => {
    const { user } = await openEmployees();
    const dialog = await fillEmployee(user);
    await user.click(within(dialog).getByRole("combobox", { name: "Linked user" }));
    await user.click(await screen.findByRole("option", { name: "Adam Admin (Admin)" }));
    fake.all("workspace_members").find((item) => item.workspace_id === WS.A && item.user_id === USERS.admin.id)!.deleted_at = "2026-09-01T00:00:00.000Z";

    await user.click(within(dialog).getByRole("button", { name: "Add Employee" }));

    expect(await screen.findByText("Selected user is not an active member of this workspace")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fake.all("employees").some((employee) => employee.name === "Eve Electric")).toBe(false);
  });

  it("keeps the dialog open with the typed values when the insert is rejected", async () => {
    const { user } = await openEmployees();
    const dialog = await fillEmployee(user);
    fake.failNext("employees", "insert", { code: "42501", message: 'new row violates row-level security policy for table "employees"' });

    await user.click(within(dialog).getByRole("button", { name: "Add Employee" }));

    expect(await screen.findByText('new row violates row-level security policy for table "employees"')).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Full Name *")).toHaveValue("Eve Electric");
    expect(unhandled.rejections).toEqual([]);
  });
});
