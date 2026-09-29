import { beforeEach, describe, expect, it, vi } from "vitest";
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
  it("creates an order with its service lines, next number, total and assignee", async () => {
    const order = await createOrder(
      { clientId: "client-a1", clientName: "Ada Alpha", device: " Golf ", carNumber: " ab123 ", vin: "", description: "", services: [oilChange, { ...oilChange, serviceId: "service-a2", serviceName: "Brake check", price: 25, quantity: 2 }], assignedEmployeeId: "employee-a1", deadline: `${year}-11-01` },
      WS.A,
    );

    expect(order).toMatchObject({ workspace_id: WS.A, client_id: "client-a1", number: `ORD-${year}-002`, device: "Golf", total_price: 90, status: "new", is_paid: false, assigned_to: USERS.member.id, service: "Oil change, Brake check" });
    expect(linesOf(String(order.id)).map((line) => [line.service_name, line.price, line.quantity])).toEqual([
      ["Oil change", 40, 1],
      ["Brake check", 25, 2],
    ]);
  });

  it("reuses an existing client by name and creates a missing one in the same workspace", async () => {
    const existing = await createOrder({ clientName: "ada alpha", device: "Car", services: [oilChange] }, WS.A);
    expect(existing.client_id).toBe("client-a1");

    const created = await createOrder({ clientName: "Walk In", device: "Car", services: [oilChange] }, WS.A);
    expect(row("clients", String(created.client_id))).toMatchObject({ name: "Walk In", workspace_id: WS.A });
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

  it("rejects an employee from another workspace and an employee without a linked user", async () => {
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], assignedEmployeeId: "employee-c1" }, WS.A)).rejects.toThrow("Selected employee was not found in this workspace");

    fake.all("employees").push({ id: "employee-unlinked", workspace_id: WS.A, name: "Nobody", profile_id: null });
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], assignedEmployeeId: "employee-unlinked" }, WS.A)).rejects.toThrow("Selected employee is not linked to a user");
  });

  it("validates input and the workspace", async () => {
    await expect(createOrder({ clientName: "", device: "Car", services: [] }, WS.A)).rejects.toThrow("Service is required");
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
});

describe("getOrders", () => {
  it("maps orders of one workspace with client name, lines and assigned employee", async () => {
    const [order] = await getOrders(WS.A);
    expect(order).toMatchObject({ id: "order-a1", clientName: "Ada Alpha", orderNumber: `ORD-${year}-001`, assignedEmployeeName: "Tom Tech", assignedEmployeeId: "employee-a1", totalPrice: 40, paymentStatus: "unpaid" });
    expect(order.services).toEqual([{ serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }]);
  });

  it("returns an empty list for a workspace the user cannot read", async () => {
    expect(await getOrders(WS.B)).toEqual([]);
  });

  it("orders newest first", async () => {
    fake.all("orders").push({ ...row("orders", "order-a1"), id: "order-a0", number: `ORD-${year}-000`, created_at: `${year - 1}-01-01T00:00:00.000Z` });
    expect((await getOrders(WS.A)).map((order) => order.id)).toEqual(["order-a1", "order-a0"]);
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

  it("refuses an order from another workspace", async () => {
    await expect(updateOrderStatus("order-c1", "cancelled", WS.A)).rejects.toThrow("Order was not found or you do not have permission to change it.");
    await expect(updateOrderStatus("order-c1", "cancelled", WS.C)).rejects.toThrow("Order was not found or you do not have permission to change it.");
    expect(row("orders", "order-c1")?.status).toBe("new");
  });

  it("surfaces Supabase errors", async () => {
    fake.failNext("orders", "update", { code: "PGRST000", message: "offline" });
    await expect(updateOrderStatus("order-a1", "completed", WS.A)).rejects.toThrow("offline");
  });
});

describe("updateOrder", () => {
  const details = { orderId: "order-a1", device: " Passat ", carNumber: " ab 001 ", vin: "", description: " Rattle ", assignedEmployeeId: "employee-a2", deadline: `${year}-12-24`, services: [] };

  it("updates details, reassigns the employee and keeps workspace_id out of the payload", async () => {
    const order = await updateOrder(details, WS.A);

    expect(order).toMatchObject({ device: "Passat", carNumber: "AB 001", description: "Rattle", assignedEmployeeName: "Tina Tech", deadline: `${year}-12-24` });
    expect(row("orders", "order-a1")).toMatchObject({ assigned_to: USERS.manager.id, workspace_id: WS.A });
    expect(fake.requests.find((item) => item.table === "orders" && item.op === "update")?.values).not.toHaveProperty("workspace_id");
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
    expect(order).toMatchObject({ totalPrice: 40, services: [oilChange] });
    expect(linesOf("order-a1")).toHaveLength(1);
  });

  it("validates the VIN length", async () => {
    await expect(updateOrder({ ...details, vin: "SHORT" }, WS.A)).rejects.toThrow("VIN must contain exactly 17 characters");
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
});
