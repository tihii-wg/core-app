import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const VIN = "WVWZZZ1JZXW000001";
const dashboardPath = `/en/${WS.A}/dashboard`;
let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

type User = ReturnType<typeof renderApp>["user"];

async function openDashboard() {
  fake.signInAs(USERS.owner.id);
  const app = renderApp(dashboardPath);
  await screen.findByText("Quick Actions");
  return app;
}

async function openQuickAction(user: User, button: string, dialogTitle: string) {
  await user.click(screen.getByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(dialogTitle)).toBeInTheDocument();
  return dialog;
}

async function expectClosedOnDashboard(location: { pathname: string }) {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(location.pathname).toBe(dashboardPath);
  expect(screen.getByText("Quick Actions")).toBeInTheDocument();
}

describe("dashboard quick actions", () => {
  it.each([
    ["Create Order", "Create New Order"],
    ["Add Client", "Add New Client"],
    ["Add Inventory", "Add Inventory Item"],
  ])("%s opens its create form in a dialog over the dashboard", async (button, dialogTitle) => {
    const { user, location } = await openDashboard();

    await openQuickAction(user, button, dialogTitle);
    expect(location.pathname).toBe(dashboardPath);

    await user.keyboard("{Escape}");
    await expectClosedOnDashboard(location);
    expect(unhandled.rejections).toEqual([]);
  });

  it("creates an order from the dashboard, closes the dialog and shows it in Recent Orders", async () => {
    const { user, location } = await openDashboard();
    const dialog = await openQuickAction(user, "Create Order", "Create New Order");

    await user.type(within(dialog).getByPlaceholderText("Client"), "Ada");
    await user.click(await within(dialog).findByRole("button", { name: "Ada Alpha Individual" }));
    await user.type(within(dialog).getByLabelText("Device *"), "Golf IV");
    await user.type(within(dialog).getByLabelText("Car Number *"), "abc123");
    await user.type(within(dialog).getByLabelText("VIN *"), VIN.toLowerCase());
    await user.click(within(dialog).getByPlaceholderText("Service"));
    await user.click(await within(dialog).findByRole("button", { name: "Oil change" }));
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Tom Tech" }));
    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));

    await expectClosedOnDashboard(location);
    expect(fake.all("orders").find((order) => order.device === "Golf IV")).toMatchObject({ workspace_id: WS.A, client_id: "client-a1" });
    expect(await screen.findByText("Golf IV")).toBeInTheDocument();
  });

  it("creates an order with a new client and its contact details from the dashboard", async () => {
    const { user, location } = await openDashboard();
    const dialog = await openQuickAction(user, "Create Order", "Create New Order");

    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Tom Tech" }));
    await user.type(within(dialog).getByPlaceholderText("Client"), "Nina New");
    expect(within(dialog).getByRole("combobox", { name: "Client type *" })).toHaveTextContent("Individual");
    expect(within(dialog).queryByLabelText("IDNO")).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Phone *"), "+37369000001");
    await user.type(within(dialog).getByLabelText("Email *"), "nina@example.com");
    await user.type(within(dialog).getByLabelText("Device *"), "Golf IV");
    await user.type(within(dialog).getByLabelText("Car Number *"), "abc123");
    await user.type(within(dialog).getByLabelText("VIN *"), VIN);
    await user.click(within(dialog).getByPlaceholderText("Service"));
    await user.click(await within(dialog).findByRole("button", { name: "Oil change" }));
    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));

    await expectClosedOnDashboard(location);
    const newClients = fake.all("clients").filter((client) => client.name === "Nina New");
    expect(newClients).toEqual([expect.objectContaining({ workspace_id: WS.A, client_type: "individual", tax_id: null, contact_person: null, phone: "+37369000001", email: "nina@example.com" })]);
    expect(fake.all("orders").find((order) => order.device === "Golf IV")?.client_id).toBe(newClients[0].id);
  });

  it("creates a client from the dashboard and closes the dialog", async () => {
    const { user, location } = await openDashboard();
    const dialog = await openQuickAction(user, "Add Client", "Add New Client");

    await user.type(within(dialog).getByLabelText("Full name *"), "Carla Client");
    await user.type(within(dialog).getByLabelText("Email *"), "carla@example.com");
    await user.type(within(dialog).getByLabelText("Phone *"), "+37369123456");
    await user.click(within(dialog).getByRole("button", { name: "Add Client" }));

    await expectClosedOnDashboard(location);
    expect(fake.all("clients").find((client) => client.name === "Carla Client")).toMatchObject({ workspace_id: WS.A, added_by: USERS.owner.id });
  });

  it("creates an inventory item from the dashboard and closes the dialog", async () => {
    const { user, location } = await openDashboard();
    const dialog = await openQuickAction(user, "Add Inventory", "Add Inventory Item");

    await user.type(await within(dialog).findByLabelText("Name *"), "Spark plug");
    await user.type(within(dialog).getByLabelText("SKU"), "SP-9");
    await user.click(within(dialog).getByRole("button", { name: "Add Item" }));

    await expectClosedOnDashboard(location);
    expect(fake.all("inventory_items").find((item) => item.name === "Spark plug")).toMatchObject({ workspace_id: WS.A, sku: "SP-9" });
  });

  it("keeps the dialog open on the dashboard when the insert is rejected", async () => {
    const { user, location } = await openDashboard();
    const dialog = await openQuickAction(user, "Add Client", "Add New Client");
    await user.type(within(dialog).getByLabelText("Full name *"), "Carla Client");
    await user.type(within(dialog).getByLabelText("Email *"), "carla@example.com");
    await user.type(within(dialog).getByLabelText("Phone *"), "+37369123456");
    fake.failNext("clients", "insert", { code: "42501", message: 'new row violates row-level security policy for table "clients"' });

    await user.click(within(dialog).getByRole("button", { name: "Add Client" }));

    expect(await screen.findByText('new row violates row-level security policy for table "clients"')).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(location.pathname).toBe(dashboardPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("shows the client type stored in Supabase in Recent Orders", async () => {
    row("clients", "client-a1")!.client_type = "organization";
    await openDashboard();

    const orderRow = await screen.findByRole("row", { name: /Ada Alpha/ });
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    const clientTypeColumn = headers.indexOf("Client Type");
    expect(clientTypeColumn).toBe(headers.indexOf("Client") + 1);
    expect(within(orderRow).getAllByRole("cell")[clientTypeColumn]).toHaveTextContent(/^Organization$/);
    expect(within(orderRow).getAllByRole("cell")[headers.indexOf("Client")]).toHaveTextContent(/^Ada Alpha$/);
  });

  it("opens the order details first, then edits the order from the panel and stays on the dashboard", async () => {
    const { user, location } = await openDashboard();
    const orderNumber = `ORD-${new Date().getFullYear()}-001`;

    await user.click(await screen.findByText("Alpha Garage car"));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(orderNumber)).toBeInTheDocument();
    expect(within(panel).getByText("Update Status")).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Device *")).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    const device = await within(panel).findByLabelText("Device *");
    expect(device).toHaveValue("Alpha Garage car");
    await user.clear(device);
    await user.type(device, "Alpha van");
    await user.type(within(panel).getByLabelText("VIN *"), VIN);
    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    await expectClosedOnDashboard(location);
    expect(row("orders", "order-a1")).toMatchObject({ device: "Alpha van", vin: VIN, workspace_id: WS.A });
    expect(await screen.findByText("Alpha van")).toBeInTheDocument();
  });

  it("returns to the order details when editing is cancelled, without saving", async () => {
    const { user, location } = await openDashboard();

    await user.click(await screen.findByText("Alpha Garage car"));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    await user.clear(await within(panel).findByLabelText("Device *"));
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));

    expect(within(panel).getByText("Update Status")).toBeInTheDocument();
    expect(location.pathname).toBe(dashboardPath);
    expect(row("orders", "order-a1")?.device).toBe("Alpha Garage car");
    expect(fake.requests.filter((request) => request.table === "orders" && request.op === "update")).toHaveLength(0);
  });

  it("changes the order status from the dashboard's order details panel", async () => {
    const { user, location } = await openDashboard();

    await user.click(await screen.findByText("Alpha Garage car"));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Paid" }));

    await waitFor(() => expect(row("orders", "order-a1")).toMatchObject({ status: "paid", is_paid: true }));
    await waitFor(() => expect(within(panel).getByRole("combobox")).toHaveTextContent("Paid"));
    expect(location.pathname).toBe(dashboardPath);
  });

  it("toggles Recent Orders to Active Orders from the Active Orders card and back", async () => {
    fake.all("orders").push({ ...row("orders", "order-a1")!, id: "order-a-closed", number: `ORD-${new Date().getFullYear()}-002`, device: "Closed car", status: "completed" });
    const { user, location } = await openDashboard();

    const card = await screen.findByRole("button", { name: /^Active Orders\s*1$/ });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Recent Orders" })).toBeInTheDocument();
    expect(await screen.findByText("Closed car")).toBeInTheDocument();
    expect(screen.getByText("Alpha Garage car")).toBeInTheDocument();

    await user.click(card);

    expect(screen.getByRole("button", { name: /^All Orders\s*2$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Active Orders" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent Orders" })).not.toBeInTheDocument();
    expect(screen.getByText("Alpha Garage car")).toBeInTheDocument();
    expect(screen.queryByText("Closed car")).not.toBeInTheDocument();
    expect(location.pathname).toBe(dashboardPath);

    await user.click(screen.getByRole("button", { name: /^All Orders/ }));

    expect(screen.getByRole("button", { name: /^Active Orders\s*1$/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Recent Orders" })).toBeInTheDocument();
    expect(screen.getByText("Closed car")).toBeInTheDocument();
    expect(screen.getByText("Alpha Garage car")).toBeInTheDocument();
    expect(location.pathname).toBe(dashboardPath);
  });

  it("explains when there are no active orders", async () => {
    row("orders", "order-a1")!.status = "completed";
    const { user } = await openDashboard();

    await user.click(await screen.findByRole("button", { name: /^Active Orders/ }));

    expect(screen.getByRole("heading", { name: "Active Orders" })).toBeInTheDocument();
    expect(screen.getByText("No active orders")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Garage car")).not.toBeInTheDocument();
  });

  it("Create Invoice stays on the dashboard because invoices are not backed by the database yet", async () => {
    const { user, location } = await openDashboard();

    await user.click(screen.getByRole("button", { name: "Create Invoice" }));

    expect(location.pathname).toBe(dashboardPath);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
