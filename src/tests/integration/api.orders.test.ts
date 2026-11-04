import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder, getOrders, updateOrder, updateOrderStatus } from "../../services/apiOrders";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const year = new Date().getFullYear();
const oilChange = { serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 };

beforeEach(() => {
  seedCoreApp();
  fake.signInAs(USERS.member.id);
});

function linesOf(orderId: string) {
  return fake.all("order_services").filter((line) => line.order_id === orderId);
}

describe("createOrder", () => {
  it("assigns a technician without profile_id and stores the employee id", async () => {
    fake.all("employees").push({
      id: "employee-unlinked",
      workspace_id: WS.A,
      name: "Una Unlinked",
      email: "una@example.com",
      phone: "+37362222223",
      role: "technician",
      status: "active",
      profile_id: null,
    });

    const order = await createOrder(
      {
        clientId: "client-a1",
        clientName: "Ada Alpha",
        device: "Golf",
        services: [oilChange],
        assignedEmployeeId: "employee-unlinked",
      },
      WS.A,
    );

    expect(order).toMatchObject({ employee_id: "employee-unlinked", assigned_to: null });
    expect(row("orders", String(order.id))).toMatchObject({ employee_id: "employee-unlinked", assigned_to: null, workspace_id: WS.A });
  });

  it("rejects an employee from another workspace", async () => {
    await expect(
      createOrder(
        {
          clientId: "client-a1",
          clientName: "Ada Alpha",
          device: "Golf",
          services: [oilChange],
          assignedEmployeeId: "employee-b1",
        },
        WS.A,
      ),
    ).rejects.toThrow(/not found in this workspace/i);
  });

  it("creates an order with its service lines, next number, total and assignee", async () => {
    const order = await createOrder(
      { clientId: "client-a1", clientName: "Ada Alpha", device: " Golf ", carNumber: " ab123 ", vin: "", description: "", services: [oilChange, { ...oilChange, serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 2 }], assignedEmployeeId: "employee-a1", deadline: `${year}-11-01` },
      WS.A,
    );

    expect(order).toMatchObject({ workspace_id: WS.A, client_id: "client-a1", number: `ORD-${year}-002`, device: "Golf", total_price: 90, status: "new", is_paid: false, employee_id: "employee-a1", assigned_to: null, service: "Oil change, Brake check" });
    expect(linesOf(String(order.id)).map((line) => [line.service_name, line.price, line.quantity])).toEqual([
      ["Oil change", 40, 1],
      ["Brake check", 25, 2],
    ]);
  });

  it("uses an explicit clientId and creates a new client when only a name is provided", async () => {
    const existing = await createOrder({ clientId: "client-a1", clientName: "ada alpha", device: "Car", services: [oilChange] }, WS.A);
    expect(existing.client_id).toBe("client-a1");

    const created = await createOrder({ clientName: "Walk In", clientPhone: "+37369000010", device: "Car", services: [oilChange] }, WS.A);
    expect(row("clients", String(created.client_id))).toMatchObject({ name: "Walk In", workspace_id: WS.A });
    expect(created.client_id).not.toBe("client-a1");
  });

  it("allows multiple clients with the same name and never reuses a client by name alone", async () => {
    const first = await createOrder(
      { clientName: " Pavel ", clientType: "organization", clientTaxId: " 1002600000001 ", clientContactPerson: " Ion ", clientPhone: " +37369111111 ", device: "Car", services: [oilChange] },
      WS.A,
    );
    expect(row("clients", String(first.client_id))).toMatchObject({ name: "Pavel", client_type: "organization", tax_id: "1002600000001", contact_person: "Ion", phone: "+37369111111", workspace_id: WS.A });

    const walkIn = await createOrder({ clientName: "Walk In Two", clientTaxId: "999", clientContactPerson: "Nobody", clientPhone: "+37369000003", device: "Car", services: [oilChange] }, WS.A);
    expect(row("clients", String(walkIn.client_id))).toMatchObject({ client_type: "individual", tax_id: null, contact_person: null });

    const clientsBefore = fake.all("clients").length;
    Object.assign(row("clients", String(first.client_id))!, { email: "legacy@example.com" });
    const second = await createOrder({ clientName: "pavel", clientPhone: "+37368222222", device: "Car", services: [oilChange] }, WS.A);
    expect(second.client_id).not.toBe(first.client_id);
    expect(fake.all("clients")).toHaveLength(clientsBefore + 1);
    expect(row("clients", String(first.client_id))).toMatchObject({ phone: "+37369111111", email: "legacy@example.com" });
    expect(row("clients", String(second.client_id))).toMatchObject({ name: "pavel", phone: "+37368222222" });
  });

  it("resolves a service by name inside the workspace and ignores a service id from another workspace", async () => {
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [{ serviceId: "service-c1", serviceName: "oil change", price: 40, quantity: 1 }] }, WS.A);
    expect(linesOf(String(order.id))[0]).toMatchObject({ service_id: "service-a1", service_name: "Oil change" });
  });

  it("does not let a member create a new catalogue service through an order", async () => {
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [{ serviceId: "", serviceName: "Brand new", price: 5, quantity: 1 }] }, WS.A)).rejects.toThrow(
      "You do not have permission to create services in this workspace.",
    );
    expect(fake.all("orders").filter((item) => item.workspace_id === WS.A)).toHaveLength(1);
  });

  it("lets an owner create the missing service while creating the order", async () => {
    fake.signInAs(USERS.owner.id);
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [{ serviceId: "", serviceName: "Brand new", price: 5, quantity: 3 }] }, WS.A);
    expect(order.total_price).toBe(15);
    expect(fake.all("services").some((item) => item.service_name === "Brand new" && item.workspace_id === WS.A)).toBe(true);
  });

  it("validates input and the workspace", async () => {
    await expect(createOrder({ clientName: "", device: "Car", services: [] }, WS.A)).rejects.toThrow("Client is required");
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [] }, WS.A)).rejects.toThrow("Service is required");
    await expect(createOrder({ clientName: "", device: "Car", services: [oilChange] }, WS.A)).rejects.toThrow("Client is required");
    await expect(createOrder({ clientName: "X", device: "Car", services: [oilChange] }, undefined)).rejects.toThrow("No active workspace selected");
  });

  it("is refused for a workspace the user is not a member of", async () => {
    await expect(createOrder({ clientId: "client-c1", clientName: "", device: "Car", services: [{ serviceId: "", serviceName: "Gamma tune", price: 1, quantity: 1 }] }, WS.C)).rejects.toThrow();
    expect(fake.all("orders").filter((item) => item.workspace_id === WS.C)).toHaveLength(1);
  });

  it("surfaces an error from the order_services insert", async () => {
    fake.failNext("order_services", "insert", { code: "42501", message: "permission denied for table order_services" });
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] }, WS.A)).rejects.toThrow("permission denied for table order_services");
  });

  it("creates an order with a freeform material and leaves inventory quantity unchanged", async () => {
    const beforeQty = Number(row("inventory_items", "item-a1")?.quantity ?? 0);
    const order = await createOrder(
      {
        clientId: "client-a1",
        clientName: "Ada Alpha",
        device: "Golf",
        services: [oilChange],
        materials: [{ itemName: "Ad-hoc seal", price: 4, quantity: 3, supplySource: "one_time" }],
      },
      WS.A,
    );

    const lines = fake.all("order_materials").filter((line) => line.order_id === order.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      inventory_item_id: null,
      item_name: "Ad-hoc seal",
      price: 4,
      quantity: 3,
      supply_source: "one_time",
      quantity_issued: 0,
    });
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(beforeQty);
    expect(Number(order.total_price)).toBe(40 + 12);
  });
});

describe("order numbers", () => {
  const inA = { clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] };
  const inB = { clientId: "client-b1", clientName: "", device: "Car", services: [{ serviceId: "service-b1", serviceName: "Beta wash", price: 15, quantity: 1 }] };
  const duplicateNumber = { code: "23505", message: 'duplicate key value violates unique constraint "orders_number_key"' };

  function at(instant: string) {
    vi.setSystemTime(new Date(instant));
  }

  function setTimeZone(workspaceId: string, timezone: string) {
    row("workspaces", workspaceId)!.timezone = timezone;
  }

  function numbersIn(workspaceId: string) {
    return fake.all("orders").filter((order) => order.workspace_id === workspaceId).map((order) => String(order.number));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fake.signInAs(USERS.owner.id);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("numbers the first two orders of 2026 ORD-2026-001 and -002 and the first order of 2027 ORD-2027-001", async () => {
    fake.tables.orders = fake.all("orders").filter((order) => order.workspace_id !== WS.A);

    at("2026-10-04T09:00:00Z");
    const first = await createOrder(inA, WS.A);
    const second = await createOrder(inA, WS.A);
    at("2027-01-01T10:00:00Z");
    const nextYear = await createOrder(inA, WS.A);

    expect([first, second, nextYear].map((order) => [order.number, order.created_at])).toEqual([
      ["ORD-2026-001", "2026-10-04T09:00:00.000Z"],
      ["ORD-2026-002", "2026-10-04T09:00:00.000Z"],
      ["ORD-2027-001", "2027-01-01T10:00:00.000Z"],
    ]);
  });

  it("takes the year from the created_at the database stored, not from the device clock", async () => {
    const withDefaults = fake.defaults.orders ?? ((order) => order);
    fake.defaults.orders = (order) => withDefaults({ ...order, created_at: "2030-12-31T22:00:03.000Z" });
    at("2030-12-31T21:59:59Z");

    expect(await createOrder(inA, WS.A)).toMatchObject({ number: "ORD-2031-001", created_at: "2030-12-31T22:00:03.000Z" });
  });

  it("uses the workspace time zone around New Year and falls back to Europe/Chisinau", async () => {
    at("2030-12-31T21:59:59Z");
    expect((await createOrder(inA, WS.A)).number).toBe("ORD-2030-001");
    at("2030-12-31T22:00:00Z");
    expect((await createOrder(inA, WS.A)).number).toBe("ORD-2031-001");
    setTimeZone(WS.B, "UTC");
    expect((await createOrder(inB, WS.B)).number).toBe("ORD-2030-001");

    at("2032-12-31T12:00:00Z");
    setTimeZone(WS.A, "Pacific/Kiritimati");
    setTimeZone(WS.B, "Pacific/Pago_Pago");
    expect((await createOrder(inA, WS.A)).number).toBe("ORD-2033-001");
    expect((await createOrder(inB, WS.B)).number).toBe("ORD-2032-001");

    at("2034-12-31T22:30:00Z");
    setTimeZone(WS.A, "Not/AZone");
    setTimeZone(WS.B, "");
    expect((await createOrder(inA, WS.A)).number).toBe("ORD-2035-001");
    expect((await createOrder(inB, WS.B)).number).toBe("ORD-2035-001");
  });

  it("continues each workspace's own sequence from its existing numbers and leaves existing numbers unchanged", async () => {
    fake.all("orders").push(
      { ...row("orders", "order-a1"), id: "order-a7", number: "ORD-2030-007" },
      { ...row("orders", "order-a1"), id: "order-a-prev", number: "ORD-2029-012" },
      { ...row("orders", "order-a1"), id: "order-a-legacy", number: "ORD-1790453886405" },
      { ...row("orders", "order-b1"), id: "order-b41", number: "ORD-2030-041" },
    );
    const before = { A: numbersIn(WS.A), B: numbersIn(WS.B) };

    at("2030-06-15T09:00:00Z");
    expect((await createOrder(inA, WS.A)).number).toBe("ORD-2030-008");
    expect((await createOrder(inB, WS.B)).number).toBe("ORD-2030-042");

    expect(numbersIn(WS.A)).toEqual([...before.A, "ORD-2030-008"]);
    expect(numbersIn(WS.B)).toEqual([...before.B, "ORD-2030-042"]);
  });

  it("never changes the number when the order is edited or shown in a later year", async () => {
    at("2030-12-31T21:30:00Z");
    const order = await createOrder(inA, WS.A);
    expect(order.number).toBe("ORD-2030-001");

    at("2031-01-01T10:00:00Z");
    await updateOrder({ orderId: String(order.id), device: "Renamed", carNumber: "NEW001", vin: "", description: "Edited", assignedEmployeeId: "", deadline: "", services: [oilChange] }, WS.A);
    await updateOrderStatus(String(order.id), "completed", WS.A);

    expect(row("orders", String(order.id))).toMatchObject({ number: "ORD-2030-001", device: "Renamed", status: "completed" });
    const shown = await getOrders(WS.A);
    expect(shown.find((item) => item.id === order.id)?.orderNumber).toBe("ORD-2030-001");
    expect(shown.find((item) => item.id === "order-a1")?.orderNumber).toBe(`ORD-${year}-001`);
  });

  it("moves on to the next number when the chosen one was taken in the meantime", async () => {
    at("2030-06-15T09:00:00Z");
    fake.failNext("orders", "update", duplicateNumber);

    expect((await createOrder(inA, WS.A)).number).toBe("ORD-2030-002");
  });

  it("removes the new order and reports an error when no number can be assigned", async () => {
    at("2030-06-15T09:00:00Z");
    const ordersBefore = fake.all("orders").length;
    const linesBefore = fake.all("order_services").length;
    fake.failNext("orders", "update", duplicateNumber, 5);

    await expect(createOrder(inA, WS.A)).rejects.toThrow("Could not assign an order number. Please try again.");
    expect(fake.all("orders")).toHaveLength(ordersBefore);
    expect(fake.all("order_services")).toHaveLength(linesBefore);
  });

  it("never leaves a temporary number on a created order", async () => {
    at("2030-06-15T09:00:00Z");
    await createOrder(inA, WS.A);
    await createOrder(inB, WS.B);

    expect(fake.all("orders").filter((order) => String(order.number).startsWith("ORD-PENDING-"))).toEqual([]);
  });
});

describe("getOrders", () => {
  it("maps orders of one workspace with client name, lines and assigned employee", async () => {
    const [order] = await getOrders(WS.A);
    expect(order).toMatchObject({ id: "order-a1", clientName: "Ada Alpha", orderNumber: `ORD-${year}-001`, assignedEmployeeName: "Tom Tech", assignedEmployeeId: "employee-a1", totalPrice: 40, paymentStatus: "unpaid" });
    expect(order.services).toEqual([{ id: "line-a1", serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }]);
  });

  it("returns an empty list for a workspace the user cannot read", async () => {
    expect(await getOrders(WS.B)).toEqual([]);
  });

  it("orders newest first", async () => {
    fake.all("orders").push({ ...row("orders", "order-a1"), id: "order-a0", number: `ORD-${year}-000`, created_at: `${year - 1}-01-01T00:00:00.000Z` });
    expect((await getOrders(WS.A)).map((order) => order.id)).toEqual(["order-a1", "order-a0"]);
  });

  it("searches order fields and the order's client, inside the workspace only", async () => {
    fake.all("orders").push({ ...row("orders", "order-a1"), id: "order-a2", number: `ORD-${year}-002`, client_id: "client-other", device: "Golf", car_number: "XYZ999", description: "Brakes squeal", service: "Brake check" });
    const ids = async (search: string) => (await getOrders(WS.A, search)).map((order) => order.id).sort();

    expect(await ids(`ORD-${year}-002`)).toEqual(["order-a2"]);
    expect(await ids("golf")).toEqual(["order-a2"]);
    expect(await ids("xyz999")).toEqual(["order-a2"]);
    expect(await ids("squeal")).toEqual(["order-a2"]);
    expect(await ids("brake check")).toEqual(["order-a2"]);
    expect(await ids("ada alpha")).toEqual(["order-a1"]);
    expect(await ids("+3736111")).toEqual(["order-a1"]);
    expect(await ids("Bob Beta")).toEqual([]);
    expect(await ids("   ")).toEqual(["order-a1", "order-a2"]);
  });

  it("strips PostgREST syntax characters from the order search", async () => {
    await getOrders(WS.A, "a,b).or(x");
    const orderRequest = fake.requests.filter((request) => request.table === "orders").at(-1);
    expect(orderRequest?.filters).toContain(`workspace_id=eq.${WS.A}`);
    expect(orderRequest?.filters.filter((filter) => filter.includes("ilike")).join(" ")).not.toMatch(/[,()]/);
  });

  it("surfaces errors from each query", async () => {
    await expect(getOrders(undefined)).rejects.toThrow("No active workspace selected");
    fake.failNext("orders", "select", { code: "PGRST000", message: "orders down" });
    await expect(getOrders(WS.A)).rejects.toThrow("orders down");
    fake.failNext("employees", "select", { code: "PGRST000", message: "employees down" });
    await expect(getOrders(WS.A)).rejects.toThrow("employees down");
    fake.failNext("order_services", "select", { code: "PGRST000", message: "lines down" });
    await expect(getOrders(WS.A)).rejects.toThrow("lines down");
  });
});

describe("updateOrderStatus", () => {
  it("updates the status and marks the order paid", async () => {
    await updateOrderStatus("order-a1", "in-progress", WS.A);
    expect(row("orders", "order-a1")).toMatchObject({ status: "in-progress", is_paid: false });
    await updateOrderStatus("order-a1", "paid", WS.A);
    expect(row("orders", "order-a1")).toMatchObject({ status: "paid", is_paid: true });
  });

  it("rejects changing a persisted Paid order when the caller is not the workspace owner", async () => {
    Object.assign(row("orders", "order-a1")!, { status: "paid", is_paid: true });
    fake.signInAs(USERS.member.id);
    await expect(updateOrderStatus("order-a1", "in-progress", WS.A)).rejects.toThrow(/workspace owner|paid/i);
    fake.signInAs(USERS.admin.id);
    await expect(updateOrderStatus("order-a1", "completed", WS.A)).rejects.toThrow(/workspace owner|paid/i);
    fake.signInAs(USERS.manager.id);
    await expect(updateOrderStatus("order-a1", "completed", WS.A)).rejects.toThrow(/workspace owner|paid/i);
    expect(row("orders", "order-a1")).toMatchObject({ status: "paid", is_paid: true });
  });

  it("rejects direct cancelled writes so cancel_order remains required", async () => {
    await expect(updateOrderStatus("order-a1", "cancelled", WS.A)).rejects.toThrow(/cancel/i);
  });

  it("lets the workspace owner reverse Paid and change status again", async () => {
    Object.assign(row("orders", "order-a1")!, { status: "paid", is_paid: true });
    fake.signInAs(USERS.owner.id);
    await updateOrderStatus("order-a1", "in-progress", WS.A);
    expect(row("orders", "order-a1")).toMatchObject({ status: "in-progress", is_paid: false });
    await updateOrderStatus("order-a1", "completed", WS.A);
    expect(row("orders", "order-a1")).toMatchObject({ status: "completed", is_paid: false });
  });

  it("lets non-owners change unpaid order status", async () => {
    Object.assign(row("orders", "order-a1")!, { status: "new", is_paid: false });
    fake.signInAs(USERS.member.id);
    await updateOrderStatus("order-a1", "in-progress", WS.A);
    expect(row("orders", "order-a1")).toMatchObject({ status: "in-progress", is_paid: false });
  });

  it("refuses an order from another workspace", async () => {
    await expect(updateOrderStatus("order-c1", "completed", WS.A)).rejects.toThrow("Order was not found or you do not have permission to change it.");
    await expect(updateOrderStatus("order-c1", "completed", WS.C)).rejects.toThrow("Order was not found or you do not have permission to change it.");
    expect(row("orders", "order-c1")?.status).toBe("new");
  });

  it("persists custom_status_id alongside status so reload shows the selected status", async () => {
    fake.all("status_definitions").push({
      id: "def-progress",
      workspace_id: WS.A,
      entity: "order",
      name: "In workshop",
      color: "#336699",
      status_group: "in_progress",
      system_status: "in-progress",
      code: "in_workshop",
      semantic_action: "normal",
      sort_order: 1,
      is_default: true,
      is_active: true,
      show_overdue_badge: false,
      adds_to_backorders: false,
      deleted_at: null,
    });
    Object.assign(row("orders", "order-a1")!, {
      status: "new",
      is_paid: false,
      custom_status_id: "stale-def",
    });

    const result = await updateOrderStatus("order-a1", "in-progress", WS.A);

    expect(result).toEqual({
      status: "in-progress",
      customStatusId: "def-progress",
      customStatus: { name: "In workshop", color: "#336699" },
    });
    expect(row("orders", "order-a1")).toMatchObject({
      status: "in-progress",
      custom_status_id: "def-progress",
    });

    const listed = await getOrders(WS.A);
    const refreshed = listed.find((order) => order.id === "order-a1");
    expect(refreshed?.status).toBe("in-progress");
    expect(refreshed?.customStatusId).toBe("def-progress");
    expect(refreshed?.customStatus).toEqual({ name: "In workshop", color: "#336699" });
  });

  it("surfaces Supabase errors", async () => {
    fake.failNext("orders", "update", { code: "PGRST000", message: "offline" });
    await expect(updateOrderStatus("order-a1", "completed", WS.A)).rejects.toThrow("offline");
  });
});

describe("updateOrder", () => {
  const details = { orderId: "order-a1", device: " Passat ", carNumber: " ab 001 ", vin: "", description: " Rattle ", assignedEmployeeId: "employee-a2", deadline: `${year}-12-24` };
  const savedOilChange = { ...oilChange, id: "line-a1" };
  const brakeCheck = { serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 1 };

  it("updates details, reassigns the employee and keeps workspace_id out of the payload", async () => {
    const order = await updateOrder(details, WS.A);

    expect(order).toMatchObject({ device: "Passat", carNumber: "AB 001", description: "Rattle", assignedEmployeeId: "employee-a2", assignedEmployeeName: "Tina Tech", deadline: `${year}-12-24` });
    expect(row("orders", "order-a1")).toMatchObject({ employee_id: "employee-a2", workspace_id: WS.A });
    expect(row("orders", "order-a1")).not.toMatchObject({ assigned_to: "employee-a2" });
    expect(fake.requests.find((item) => item.table === "orders" && item.op === "update")?.values).not.toHaveProperty("workspace_id");
    expect(fake.requests.filter((item) => item.table === "sync_order_materials" && item.op === "rpc")).toHaveLength(0);
  });

  it("appends new services once, skips duplicates by id or name, and recalculates the total", async () => {
    const order = await updateOrder({ ...details, services: [oilChange, { serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 2 }, { serviceId: "", serviceName: "brake CHECK", price: 25, quantity: 1 }] }, WS.A);

    expect(linesOf("order-a1").map((line) => line.service_name)).toEqual(["Oil change", "Brake check"]);
    expect(row("orders", "order-a1")).toMatchObject({ total_price: 90, service: "Oil change, Brake check" });
    expect(order.services.map((line) => line.serviceName)).toEqual(["Oil change", "Brake check"]);
    expect(order).toMatchObject({ totalPrice: 90, service: "Oil change, Brake check" });
  });

  it("returns the existing lines when no new service is added", async () => {
    const order = await updateOrder({ ...details, services: [oilChange] }, WS.A);
    expect(order).toMatchObject({ totalPrice: 40, services: [savedOilChange] });
    expect(linesOf("order-a1")).toHaveLength(1);
  });

  it("leaves saved lines untouched when nothing changed", async () => {
    await updateOrder({ ...details, services: [savedOilChange] }, WS.A);

    expect(linesOf("order-a1")).toEqual([expect.objectContaining({ id: "line-a1", service_id: "service-a1", price: 40, quantity: 1 })]);
    expect(fake.requests.filter((item) => item.table === "order_services" && (item.op === "insert" || item.op === "delete"))).toHaveLength(0);
    expect(fake.requests.filter((item) => item.table === "orders" && item.op === "update")).toHaveLength(1);
  });

  it("deletes a removed saved line, keeps the global service and recalculates the order", async () => {
    await updateOrder({ ...details, services: [savedOilChange, brakeCheck] }, WS.A);
    const brakeLine = linesOf("order-a1").find((line) => line.service_id === "service-a2")!;
    const beforeDeletes = fake.requests.length;

    const order = await updateOrder({ ...details, services: [{ ...brakeCheck, id: String(brakeLine.id) }] }, WS.A);

    expect(linesOf("order-a1").map((line) => line.id)).toEqual([brakeLine.id]);
    expect(row("services", "service-a1")).toBeDefined();
    expect(row("orders", "order-a1")).toMatchObject({ total_price: 25, service: "Brake check", service_id: "service-a2" });
    expect(order).toMatchObject({ totalPrice: 25, service: "Brake check", services: [{ ...brakeCheck, id: brakeLine.id }] });
    expect((await getOrders(WS.A)).find((item) => item.id === "order-a1")?.services).toEqual([{ ...brakeCheck, id: brakeLine.id }]);

    const deletes = fake.requests.slice(beforeDeletes).filter((item) => item.table === "order_services" && item.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.filters.some((filter) => filter.startsWith("order_id="))).toBe(true);
    expect(deletes[0]?.filters.some((filter) => filter.startsWith("id="))).toBe(true);
    expect(fake.all("order_services").some((line) => line.order_id === "order-c1")).toBe(true);
  });

  it("replaces a removed saved line with a new one so the lines match the form exactly", async () => {
    const order = await updateOrder({ ...details, services: [brakeCheck] }, WS.A);

    expect(linesOf("order-a1").map((line) => [line.service_name, line.price, line.quantity])).toEqual([["Brake check", 25, 1]]);
    expect(row("orders", "order-a1")).toMatchObject({ total_price: 25, service: "Brake check" });
    expect(order.services).toEqual([expect.objectContaining({ ...brakeCheck, id: expect.any(String) })]);
  });

  it("never inserts the same service twice", async () => {
    await updateOrder({ ...details, services: [savedOilChange, oilChange, { ...oilChange, serviceId: "", serviceName: "OIL CHANGE" }, brakeCheck, { ...brakeCheck, serviceId: "" }] }, WS.A);
    expect(linesOf("order-a1").map((line) => line.service_name)).toEqual(["Oil change", "Brake check"]);
  });

  it("refuses to save an order without services", async () => {
    await expect(updateOrder({ ...details, services: [] }, WS.A)).rejects.toThrow("Service is required");
    expect(linesOf("order-a1")).toHaveLength(1);
    expect(fake.requests.filter((item) => item.op !== "select")).toHaveLength(0);
  });

  it("ignores a line id from another order instead of touching it", async () => {
    await updateOrder({ ...details, services: [savedOilChange, { ...brakeCheck, id: "line-c1" }] }, WS.A);

    expect(fake.all("order_services").find((line) => line.id === "line-c1")).toMatchObject({ order_id: "order-c1" });
    expect(linesOf("order-a1").map((line) => line.service_name)).toEqual(["Oil change", "Brake check"]);
    expect(linesOf("order-a1").some((line) => line.id === "line-c1")).toBe(false);
  });

  it("surfaces an error when deleting a line is rejected", async () => {
    fake.failNext("order_services", "delete", { code: "42501", message: "permission denied for table order_services" });
    await expect(updateOrder({ ...details, services: [brakeCheck] }, WS.A)).rejects.toThrow("permission denied for table order_services");
  });

  it("validates the VIN length", async () => {
    await expect(updateOrder({ ...details, vin: "SHORT" }, WS.A)).rejects.toThrow(
      "VIN must contain exactly 17 valid characters (A–Z and 0–9, excluding I, O, and Q)",
    );
  });

  it("stores a valid VIN in upper case", async () => {
    const order = await updateOrder({ ...details, vin: "wvwzzz1kzaw000001" }, WS.A);
    expect(order.vin).toBe("WVWZZZ1KZAW000001");
  });

  it("refuses an order from another workspace and leaves it untouched", async () => {
    await expect(updateOrder({ ...details, orderId: "order-c1", assignedEmployeeId: "" }, WS.A)).rejects.toThrow("Order was not found or you do not have permission to change it.");
    expect(row("orders", "order-c1")?.device).toBe("Gamma Motors car");
  });

  it("surfaces an error when appending lines fails", async () => {
    fake.failNext("order_services", "insert", { code: "PGRST000", message: "insert failed" });
    await expect(updateOrder({ ...details, services: [{ serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 1 }] }, WS.A)).rejects.toThrow("insert failed");
  });

  it("saves catalog and freeform materials together without inventing catalog ids for freeform lines", async () => {
    const beforeQty = Number(row("inventory_items", "item-a1")?.quantity ?? 0);
    const order = await updateOrder(
      {
        ...details,
        services: [savedOilChange],
        materials: [
          { inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 2, supplySource: "catalog" },
          { itemName: " Special gasket ", price: 7.5, quantity: 1, supplySource: "one_time" },
          { itemName: "Customer rotor", price: 0, quantity: 1, supplySource: "customer" },
        ],
      },
      WS.A,
    );

    const lines = fake.all("order_materials").filter((line) => line.order_id === "order-a1");
    expect(lines).toHaveLength(3);
    expect(lines.find((line) => line.inventory_item_id === "item-a1")).toMatchObject({
      quantity: 2,
      supply_source: "catalog",
      price: 12,
    });
    expect(lines.find((line) => line.supply_source === "one_time")).toMatchObject({
      inventory_item_id: null,
      item_name: "Special gasket",
      price: 7.5,
      quantity: 1,
      quantity_issued: 0,
    });
    expect(lines.find((line) => line.supply_source === "customer")).toMatchObject({
      inventory_item_id: null,
      item_name: "Customer rotor",
      price: 0,
    });
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(beforeQty);
    const materials = order.materials ?? [];
    expect(materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryItemId: "item-a1", supplySource: "catalog", quantity: 2 }),
        expect.objectContaining({ itemName: "Special gasket", supplySource: "one_time", price: 7.5 }),
        expect.objectContaining({ itemName: "Customer rotor", supplySource: "customer", price: 0 }),
      ]),
    );
    expect(materials.filter((line) => line.supplySource !== "catalog").every((line) => !line.inventoryItemId)).toBe(true);
  });
});
