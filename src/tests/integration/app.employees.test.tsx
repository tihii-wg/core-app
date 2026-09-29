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
    expect(fake.all("employees").find((employee) => employee.name === "Eve Electric")).toMatchObject({ workspace_id: WS.A, role: "technician", status: "active" });
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
