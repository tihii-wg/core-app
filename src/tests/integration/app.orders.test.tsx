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
  await user.click(await within(dialog).findByRole("button", { name: "Ada Alpha" }));
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

  it("lists only orders of the active workspace", async () => {
    await openOrders();
    expect(screen.getByText("1 total orders")).toBeInTheDocument();
    expect(screen.queryByText("Bob Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Gus Gamma")).not.toBeInTheDocument();
    expect(fake.requests.filter((request) => request.table === "orders" && request.op === "select").every((request) => request.filters.includes(`workspace_id=eq.${WS.A}`) || request.filters.length === 0)).toBe(true);
  });
});
