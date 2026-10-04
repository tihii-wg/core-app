import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const VIN = "WVWZZZ1JZXW000001";
let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function openOrders(userId = USERS.member.id) {
  fake.signInAs(userId);
  const app = renderApp(`/en/${WS.A}/orders`);
  await screen.findByText("Ada Alpha");
  return app;
}

type User = ReturnType<typeof renderApp>["user"];

async function fillNewOrder(user: User, dialog: HTMLElement) {
  await user.type(within(dialog).getByPlaceholderText("Client"), "Ada");
  await user.click(await within(dialog).findByRole("button", { name: "Ada Alpha Individual" }));
  await user.type(within(dialog).getByLabelText("Device *"), "Golf IV");
  await user.type(within(dialog).getByLabelText("Car Number *"), "abc123");
  await user.type(within(dialog).getByLabelText("VIN *"), VIN.toLowerCase());
  await user.click(within(dialog).getByPlaceholderText("Service"));
  await user.click(await within(dialog).findByRole("button", { name: "Oil change" }));
  await user.click(within(dialog).getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "Tom Tech" }));
}

async function openOrderPanel(user: User) {
  await user.click(screen.getByText("Ada Alpha"));
  return screen.findByRole("dialog");
}

describe("orders page", () => {
  it("creates an order with a line item in the active workspace", async () => {
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");
    await fillNewOrder(user, dialog);

    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Order created successfully")).toBeInTheDocument();
    const created = fake.all("orders").find((order) => order.device === "Golf IV");
    expect(created).toMatchObject({ workspace_id: WS.A, client_id: "client-a1", car_number: "ABC123", vin: VIN, total_price: 40, assigned_to: USERS.member.id });
    expect(fake.all("order_services").filter((line) => line.order_id === created?.id)).toEqual([expect.objectContaining({ service_id: "service-a1", price: 40, quantity: 1 })]);
    expect(await screen.findByText("Golf IV")).toBeInTheDocument();
  });

  it("creates a new client with phone and email from the order form and links it to the order", async () => {
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");
    await fillNewOrder(user, dialog);
    const client = within(dialog).getByPlaceholderText("Client");
    await user.clear(client);
    await user.type(client, "Nina New");
    await user.click(within(dialog).getByRole("combobox", { name: "Client type *" }));
    await user.click(await screen.findByRole("option", { name: "Organization" }));
    expect(within(dialog).getByLabelText("Organization name *")).toHaveValue("Nina New");
    await user.type(within(dialog).getByLabelText("IDNO"), "1002600000001");
    await user.type(within(dialog).getByLabelText("Contact name"), "Ion Popescu");
    await user.type(within(dialog).getByLabelText("Phone *"), "+37369000001");
    await user.type(within(dialog).getByLabelText("Email *"), "nina@example.com");

    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const created = fake.all("orders").find((order) => order.device === "Golf IV");
    const newClients = fake.all("clients").filter((item) => item.name === "Nina New");
    expect(newClients).toEqual([
      expect.objectContaining({ workspace_id: WS.A, client_type: "organization", tax_id: "1002600000001", contact_person: "Ion Popescu", phone: "+37369000001", email: "nina@example.com" }),
    ]);
    expect(created?.client_id).toBe(newClients[0].id);
    expect(await screen.findByText("Nina New")).toBeInTheDocument();
  });

  it("does not ask for contact details or create a client when the typed name matches an existing client", async () => {
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");
    await fillNewOrder(user, dialog);
    const client = within(dialog).getByPlaceholderText("Client");
    await user.clear(client);
    await user.type(client, "ada alpha");
    expect(within(dialog).queryByLabelText("Phone *")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Client type *" })).not.toBeInTheDocument();
    const clientsBefore = fake.all("clients").length;

    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.all("orders").find((order) => order.device === "Golf IV")?.client_id).toBe("client-a1");
    expect(fake.all("clients")).toHaveLength(clientsBefore);
  });

  it("validates the required fields without calling Supabase", async () => {
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("VIN *"), "SHORT");
    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));

    expect(await within(dialog).findByText("Client is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Car is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Car number is required")).toBeInTheDocument();
    expect(within(dialog).getByText("VIN must contain exactly 17 characters")).toBeInTheDocument();
    expect(within(dialog).getByText("Service is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Assigned employee is required")).toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "orders" && request.op === "insert")).toHaveLength(0);
  });

  it("keeps the dialog open and reports the error when the insert is rejected", async () => {
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");
    await fillNewOrder(user, dialog);
    fake.failNext("orders", "insert", { code: "42501", message: 'new row violates row-level security policy for table "orders"' });

    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));

    expect(await screen.findByText('new row violates row-level security policy for table "orders"')).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Device *")).toHaveValue("Golf IV");
    expect(fake.all("orders").some((order) => order.device === "Golf IV")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("edits an order, appends a service and shows the recalculated total", async () => {
    row("services", "service-a2")!.status = "active";
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Edit" }));

    await user.type(within(panel).getByLabelText("VIN *"), VIN);
    const device = within(panel).getByLabelText("Device *");
    await user.clear(device);
    await user.type(device, "Alpha van");
    await user.click(within(panel).getByPlaceholderText("Service"));
    await user.click(await within(panel).findByRole("button", { name: "Brake check" }));
    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row("orders", "order-a1")).toMatchObject({ device: "Alpha van", vin: VIN, total_price: 65, service: "Oil change, Brake check", workspace_id: WS.A });
    expect(fake.all("order_services").filter((line) => line.order_id === "order-a1").map((line) => line.service_name)).toEqual(["Oil change", "Brake check"]);
    expect(await screen.findByText("Alpha van")).toBeInTheDocument();
    expect(screen.getByText("Oil change, Brake check")).toBeInTheDocument();
  });

  it("removes a saved service, adds another, updates the total immediately and saves exactly the shown services", async () => {
    row("services", "service-a2")!.status = "active";
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    await user.type(within(panel).getByLabelText("VIN *"), VIN);
    const total = () => within(panel).getByText("Total Price").nextElementSibling?.textContent ?? "";
    expect(total()).toMatch(/40/);

    await user.click(within(panel).getByRole("button", { name: "Remove Oil change" }));
    expect(within(panel).queryByText("Oil change")).not.toBeInTheDocument();
    expect(total()).not.toMatch(/40/);

    await user.click(within(panel).getByPlaceholderText("Service"));
    await user.click(await within(panel).findByRole("button", { name: "Brake check" }));
    expect(total()).toMatch(/25/);
    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.all("order_services").filter((line) => line.order_id === "order-a1").map((line) => line.service_name)).toEqual(["Brake check"]);
    expect(row("orders", "order-a1")).toMatchObject({ total_price: 25, service: "Brake check" });
    expect(row("services", "service-a1")).toBeDefined();

    const reopened = await openOrderPanel(user);
    await user.click(within(reopened).getByRole("button", { name: "Edit" }));
    expect(within(reopened).getByRole("button", { name: "Remove Brake check" })).toBeInTheDocument();
    expect(within(reopened).queryByRole("button", { name: "Remove Oil change" })).not.toBeInTheDocument();
  });

  it("drops a service added and removed before saving without writing it", async () => {
    row("services", "service-a2")!.status = "active";
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    await user.type(within(panel).getByLabelText("VIN *"), VIN);

    await user.click(within(panel).getByPlaceholderText("Service"));
    await user.click(await within(panel).findByRole("button", { name: "Brake check" }));
    await user.click(within(panel).getByRole("button", { name: "Remove Brake check" }));
    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.all("order_services").filter((line) => line.order_id === "order-a1")).toEqual([expect.objectContaining({ id: "line-a1", service_name: "Oil change" })]);
    expect(fake.requests.filter((request) => request.table === "order_services" && (request.op === "insert" || request.op === "delete"))).toHaveLength(0);
  });

  it("requires at least one service when editing", async () => {
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    await user.type(within(panel).getByLabelText("VIN *"), VIN);

    await user.click(within(panel).getByRole("button", { name: "Remove Oil change" }));
    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    expect(await within(panel).findByText("Service is required")).toBeInTheDocument();
    expect(fake.requests.filter((request) => ["orders", "order_services"].includes(request.table) && request.op !== "select")).toHaveLength(0);
    expect(fake.all("order_services").filter((line) => line.order_id === "order-a1")).toHaveLength(1);
  });

  it("edits an order from the row actions menu in a dialog and stays on the orders page", async () => {
    const { user, location } = await openOrders();
    const orderNumber = `ORD-${new Date().getFullYear()}-001`;

    await user.click(screen.getByRole("button", { name: `Actions for order ${orderNumber}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(`Edit Order ${orderNumber}`)).toBeInTheDocument();
    const device = within(dialog).getByLabelText("Device *");
    expect(device).toHaveValue("Alpha Garage car");
    await user.clear(device);
    await user.type(device, "Alpha van");
    await user.type(within(dialog).getByLabelText("VIN *"), VIN);
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row("orders", "order-a1")).toMatchObject({ device: "Alpha van", vin: VIN, workspace_id: WS.A });
    expect(await screen.findByText("Alpha van")).toBeInTheDocument();
    expect(location.pathname).toBe(`/en/${WS.A}/orders`);
  });

  it("closes the menu's edit dialog on cancel without saving or opening the detail panel", async () => {
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: `Actions for order ORD-${new Date().getFullYear()}-001` }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(screen.getAllByRole("dialog")).toEqual([dialog]);
    await user.clear(within(dialog).getByLabelText("Device *"));

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row("orders", "order-a1")?.device).toBe("Alpha Garage car");
    expect(fake.requests.filter((request) => request.table === "orders" && request.op === "update")).toHaveLength(0);
  });

  it("creates an invoice from the row actions menu, then shows it instead of offering another one", async () => {
    const { user } = await openOrders();
    const orderNumber = `ORD-${new Date().getFullYear()}-001`;
    const actions = screen.getByRole("button", { name: `Actions for order ${orderNumber}` });

    await user.click(actions);
    await user.click(await screen.findByRole("menuitem", { name: "Create Invoice" }));

    const invoiceNumber = `INV-${new Date().getFullYear()}-001`;
    expect(await screen.findByText(`Invoice ${invoiceNumber} created`)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.all("invoices")).toEqual([expect.objectContaining({ workspace_id: WS.A, order_id: "order-a1", client_id: "client-a1", client_name: "Ada Alpha", order_number: orderNumber, number: invoiceNumber, total: 40 })]);
    expect(fake.all("invoice_items")).toEqual([expect.objectContaining({ service_id: "service-a1", service_name: "Oil change", price: 40, quantity: 1 })]);

    await user.click(actions);
    expect(await screen.findByRole("menuitem", { name: `Invoice ${invoiceNumber} already created` })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: "Create Invoice" })).not.toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "invoices" && request.op === "insert")).toHaveLength(1);
  });

  it("reports a rejected invoice creation and keeps offering Create Invoice", async () => {
    const { user } = await openOrders();
    const actions = screen.getByRole("button", { name: `Actions for order ORD-${new Date().getFullYear()}-001` });
    fake.failNext("invoices", "insert", { code: "42501", message: 'new row violates row-level security policy for table "invoices"' });

    await user.click(actions);
    await user.click(await screen.findByRole("menuitem", { name: "Create Invoice" }));

    expect(await screen.findByText('new row violates row-level security policy for table "invoices"')).toBeInTheDocument();
    expect(fake.all("invoices")).toEqual([]);
    await user.click(actions);
    expect(await screen.findByRole("menuitem", { name: "Create Invoice" })).not.toHaveAttribute("aria-disabled");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("explains in the menu that invoices are unavailable when the database has no invoices table", async () => {
    fake.failNext("invoices", "select", { code: "PGRST205", message: "Could not find the table 'public.invoices' in the schema cache" });
    const { user } = await openOrders();

    await user.click(screen.getByRole("button", { name: `Actions for order ORD-${new Date().getFullYear()}-001` }));

    expect(await screen.findByRole("menuitem", { name: "Invoices are not set up yet" })).toHaveAttribute("aria-disabled", "true");
    expect(fake.requests.filter((request) => request.table === "invoices" && request.op === "insert")).toHaveLength(0);
  });

  it("keeps the edit form open when the update is rejected", async () => {
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    await user.type(within(panel).getByLabelText("VIN *"), VIN);
    fake.failNext("orders", "update", { code: "PGRST000", message: "Network request failed" });

    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Network request failed")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(row("orders", "order-a1")?.vin).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("changes the status from the detail panel", async () => {
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);

    await user.click(within(panel).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Paid" }));

    await waitFor(() => expect(row("orders", "order-a1")).toMatchObject({ status: "paid", is_paid: true }));
    await waitFor(() => expect(within(panel).getByRole("combobox")).toHaveTextContent("Paid"));
  });

  it("keeps the previous status when the status update is rejected", async () => {
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);
    fake.failNext("orders", "update", { code: "42501", message: "permission denied for table orders" });

    await user.click(within(panel).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Completed" }));

    expect(await screen.findByText("permission denied for table orders")).toBeInTheDocument();
    expect(row("orders", "order-a1")?.status).toBe("new");
    expect(within(panel).getByRole("combobox")).toHaveTextContent("New");
  });

  it("offers only linked active technicians as assignees when creating an order", async () => {
    fake.all("employees").push({ id: "employee-unlinked", workspace_id: WS.A, name: "Una Unlinked", email: "una@example.com", phone: "+37362222223", role: "technician", status: "active", profile_id: null });
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("combobox"));
    await screen.findByRole("option", { name: "Tom Tech" });

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Tom Tech", "Tina Tech"]);
    expect(within(dialog).queryByText(/No linked technicians/)).not.toBeInTheDocument();
  });

  it("keeps the assignee required and explains when no technician is linked to a workspace user", async () => {
    for (const employee of fake.all("employees")) if (employee.workspace_id === WS.A) employee.profile_id = null;
    const { user } = await openOrders();
    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("No linked technicians. Link an active technician to a workspace user on the Employees page first.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create Order" }));
    expect(await within(dialog).findByText("Assigned employee is required")).toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "orders" && request.op === "insert")).toHaveLength(0);
  });

  it("offers the current assignee and linked technicians, but not unlinked ones, when editing an order", async () => {
    fake.all("employees").push({ id: "employee-unlinked", workspace_id: WS.A, name: "Una Unlinked", email: "una@example.com", phone: "+37362222223", role: "technician", status: "active", profile_id: null });
    const { user } = await openOrders();
    const panel = await openOrderPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Edit" }));

    expect(within(panel).getByRole("combobox", { name: "Assigned Employee" })).toHaveTextContent("Tom Tech");
    await user.click(within(panel).getByRole("combobox", { name: "Assigned Employee" }));
    await screen.findByRole("option", { name: "Tina Tech" });

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Tom Tech", "Tina Tech"]);
  });

  it("shows the client type stored in Supabase in the table, the detail panel and the client picker", async () => {
    row("clients", "client-a1")!.client_type = "organization";
    const { user } = await openOrders();

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    const clientTypeColumn = headers.indexOf("Client Type");
    expect(clientTypeColumn).toBe(headers.indexOf("Client") + 1);
    const orderRow = screen.getByRole("row", { name: /Ada Alpha/ });
    expect(within(orderRow).getAllByRole("cell")[clientTypeColumn]).toHaveTextContent(/^Organization$/);
    expect(within(orderRow).getAllByRole("cell")[headers.indexOf("Client")]).toHaveTextContent(/^Ada Alpha$/);

    await user.click(screen.getByText("Ada Alpha"));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Client Type").parentElement).toHaveTextContent("Client TypeOrganization");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Create Order/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText("Client"), "Ada");
    expect(await within(dialog).findByRole("button", { name: "Ada Alpha Organization" })).toBeInTheDocument();
  });

  it("lists only orders of the active workspace", async () => {
    await openOrders();
    expect(screen.getByText("1 total orders")).toBeInTheDocument();
    expect(screen.queryByText("Bob Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Gus Gamma")).not.toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "orders" && request.op === "select").every((request) => request.filters.includes(`workspace_id=eq.${WS.A}`) || request.filters.length === 0)).toBe(true);
  });
});
