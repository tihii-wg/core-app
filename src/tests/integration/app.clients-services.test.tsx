import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openClients(userId: string) {
  fake.signInAs(userId);
  const app = renderApp(`/en/${WS.A}/clients`);
  await screen.findByText("Ada Alpha");
  return app;
}

async function fillClientForm(user: ReturnType<typeof renderApp>["user"], dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText("Full name *"), "Carla Client");
  await user.type(within(dialog).getByLabelText("Email *"), "carla@example.com");
  await user.type(within(dialog).getByLabelText("Phone *"), "+37369123456");
}

describe("clients page", () => {
  it("creates a client in the active workspace and shows it in the table", async () => {
    const { user } = await openClients(USERS.member.id);

    await user.click(screen.getByRole("button", { name: /Add Client/ }));
    const dialog = await screen.findByRole("dialog");
    await fillClientForm(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Add Client" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Carla Client")).toBeInTheDocument();
    expect(await screen.findByText("Client created succesfully")).toBeInTheDocument();
    expect(fake.all("clients").find((item) => item.name === "Carla Client")).toMatchObject({ workspace_id: WS.A, added_by: USERS.member.id });
  });

  it("validates required fields and the phone format without calling Supabase", async () => {
    const { user } = await openClients(USERS.member.id);
    await user.click(screen.getByRole("button", { name: /Add Client/ }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Phone *"), "069123456");
    await user.click(within(dialog).getByRole("button", { name: "Add Client" }));

    expect(await within(dialog).findByText("Full name is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Email is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Phone must be in format +37300000000")).toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "clients" && request.op === "insert")).toHaveLength(0);
  });

  it("keeps the dialog open with the typed values and shows the error when the insert is rejected", async () => {
    const { user } = await openClients(USERS.member.id);
    await user.click(screen.getByRole("button", { name: /Add Client/ }));
    const dialog = await screen.findByRole("dialog");
    await fillClientForm(user, dialog);
    fake.failNext("clients", "insert", { code: "42501", message: 'new row violates row-level security policy for table "clients"' });

    await user.click(within(dialog).getByRole("button", { name: "Add Client" }));

    expect(await screen.findByText('new row violates row-level security policy for table "clients"')).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Full name *")).toHaveValue("Carla Client");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("edits a client from the detail panel", async () => {
    const { user } = await openClients(USERS.member.id);
    await user.click(screen.getByText("Ada Alpha"));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: /Edit/ }));
    const name = await within(panel).findByLabelText("Full name *");
    await user.clear(name);
    await user.type(name, "Ada Lovelace");
    await user.click(within(panel).getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(row("clients", "client-a1")?.name).toBe("Ada Lovelace"));
    expect(await screen.findAllByText("Ada Lovelace")).not.toHaveLength(0);
  });

  it("keeps the edit form open and shows the error when the update is rejected", async () => {
    const { user } = await openClients(USERS.member.id);
    await user.click(screen.getByText("Ada Alpha"));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: /Edit/ }));
    const name = await within(panel).findByLabelText("Full name *");
    await user.clear(name);
    await user.type(name, "Ada Lovelace");
    fake.failNext("clients", "update", { code: "PGRST000", message: "Network request failed" });

    await user.click(within(panel).getByRole("button", { name: /Save/ }));

    expect(await screen.findByText("Network request failed")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Full name *")).toHaveValue("Ada Lovelace");
    expect(row("clients", "client-a1")?.name).toBe("Ada Alpha");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("searches clients through Supabase with the typed term", async () => {
    const { user } = await openClients(USERS.member.id);
    await user.type(screen.getByPlaceholderText(/Search by name/), "zzz");
    expect(await screen.findByText(/No results/i, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText("Ada Alpha")).not.toBeInTheDocument();
  });

  it("shows the empty state for a workspace without clients", async () => {
    fake.tables.clients = fake.all("clients").filter((item) => item.workspace_id !== WS.A);
    fake.signInAs(USERS.member.id);
    renderApp(`/en/${WS.A}/clients`);
    expect(await screen.findByText("0 total clients")).toBeInTheDocument();
  });

  it("shows the load error when clients cannot be read", async () => {
    fake.failNext("clients", "select", { code: "PGRST000", message: "Clients are unavailable" }, 3);
    fake.signInAs(USERS.member.id);
    renderApp(`/en/${WS.A}/clients`);
    expect(await screen.findByText("Clients are unavailable")).toBeInTheDocument();
  });
});

describe("services page permissions", () => {
  async function openServices(userId: string) {
    fake.signInAs(userId);
    const app = renderApp(`/en/${WS.A}/services`);
    await screen.findByText("Oil change");
    return app;
  }

  it.each([USERS.manager, USERS.member])("is read-only for $email", async (user) => {
    const app = await openServices(user.id);
    await waitFor(() => expect(fake.requests.some((request) => request.table === "workspace_members" && request.filters.includes(`workspace_id=eq.${WS.A}`))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole("button", { name: /Add Service/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Oil change" })).not.toBeInTheDocument();
    await app.user.click(screen.getByText("Oil change"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets an owner create a service", async () => {
    const { user } = await openServices(USERS.owner.id);
    await user.click(await screen.findByRole("button", { name: /Add Service/ }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByPlaceholderText("Service"), "Tyre fitting");
    await user.type(within(dialog).getByLabelText(/Price/), "20");
    await user.click(within(dialog).getByRole("button", { name: "Add Service" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Tyre fitting")).toBeInTheDocument();
    expect(fake.all("services").find((item) => item.service_name === "Tyre fitting")).toMatchObject({ workspace_id: WS.A, service_price: 20 });
  });

  it("keeps the create dialog open when the name is taken", async () => {
    const { user } = await openServices(USERS.owner.id);
    await user.click(await screen.findByRole("button", { name: /Add Service/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText("Service"), "Oil change");
    await user.type(within(dialog).getByLabelText(/Price/), "20");
    await user.click(within(dialog).getByRole("button", { name: "Add Service" }));

    expect(await screen.findByText("Service with this name is already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lets an admin edit a service", async () => {
    const { user } = await openServices(USERS.admin.id);
    await user.click(screen.getByText("Oil change"));
    const dialog = await screen.findByRole("dialog");
    const price = within(dialog).getByLabelText(/Price/);
    await user.clear(price);
    await user.type(price, "55");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(row("services", "service-a1")?.service_price).toBe(55));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the edit dialog open when saving fails", async () => {
    const { user } = await openServices(USERS.admin.id);
    await user.click(screen.getByText("Oil change"));
    const dialog = await screen.findByRole("dialog");
    const price = within(dialog).getByLabelText(/Price/);
    await user.clear(price);
    await user.type(price, "55");
    fake.failNext("services", "update", { code: "42501", message: "permission denied for table services" });

    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("You do not have permission to edit this service.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText(/Price/)).toHaveValue(55);
  });

  it("refuses deleting a service used by orders and deletes an unused one", async () => {
    const { user } = await openServices(USERS.owner.id);

    await user.click(await screen.findByRole("button", { name: "Delete Oil change" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("This service is used in orders and cannot be deleted. Set it to inactive instead.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Delete Brake check" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Brake check")).not.toBeInTheDocument());
    expect(row("services", "service-a2")).toBeUndefined();
  });
});
