import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder, getOrders, resetOrderDiscountSupport, updateOrder } from "./apiOrders";
import { fake } from "../tests/fakeSupabase";
import { seedCoreApp, USERS, WS, row } from "../tests/coreAppDb";
import { installOrderLineDiscountsRpc } from "../tests/orderRpcMocks";

vi.mock("./supabase", async () => ({ default: (await import("../tests/fakeSupabase")).fakeClient }));

const oilChange = { serviceId: "service-a1", serviceName: "Oil change", price: 100, quantity: 1 };
const brakeCheck = { serviceId: "service-a2", serviceName: "Brake check", price: 50, quantity: 2 };
const brakePads = { inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 2 };
const details = { device: "Car", carNumber: "AAA111", vin: "", description: "", assignedEmployeeId: "employee-a1", deadline: "" };

function seedDiscount(target: string, percent: number, clientId = "client-a1") {
  fake.all("client_discounts").push({ id: `${clientId}-${target}`, workspace_id: WS.A, client_id: clientId, target, mode: "fixed", percent, price_type_id: null, updated_at: "2026-01-01T00:00:00.000Z" });
}

function linesOf(orderId: string) {
  return fake.all("order_services").filter((line) => line.order_id === orderId);
}

beforeEach(() => {
  seedCoreApp();
  fake.signInAs(USERS.member.id);
  resetOrderDiscountSupport();
});

describe("createOrder persists client discounts", () => {
  it("stamps service_order on service lines and stores net total, discount_total and uniform header percent", async () => {
    seedDiscount("service_order", 10);
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange, brakeCheck] }, WS.A);

    expect(linesOf(String(order.id)).map((line) => [line.service_name, line.discount_type, line.discount_value])).toEqual([
      ["Oil change", "percent", 10],
      ["Brake check", "percent", 10],
    ]);
    // gross 200, discount 20
    expect(row("orders", String(order.id))).toMatchObject({ total_price: 180, discount_total: 20, discount_type: "percent", discount_value: 10 });

    const loaded = (await getOrders(WS.A)).find((item) => item.id === order.id);
    expect(loaded).toMatchObject({ subtotal: 200, discountTotal: 20, totalPrice: 180, discountType: "percent", discountValue: 10 });
    expect(loaded?.services[0]).toMatchObject({ discountType: "percent", discountValue: 10 });
  });

  it("leaves a line without discount rows when the client has none (no discount columns written)", async () => {
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] }, WS.A);
    expect(linesOf(String(order.id))[0]).not.toHaveProperty("discount_type");
    expect(row("orders", String(order.id))).toMatchObject({ total_price: 100, discount_total: 0, discount_type: null });
  });

  it("does not stamp a line that arrives with its own discount (no double application)", async () => {
    seedDiscount("service_order", 10);
    const order = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Car", services: [{ ...oilChange, discountType: "amount", discountValue: 30 }] },
      WS.A,
    );
    expect(linesOf(String(order.id))[0]).toMatchObject({ discount_type: "amount", discount_value: 30 });
    // amount discounts are not a uniform percent -> header stays NULL, discount_total carries the truth
    expect(row("orders", String(order.id))).toMatchObject({ total_price: 70, discount_total: 30, discount_type: null, discount_value: null });
  });

  it("retries the order insert without discount_total when the column is missing", async () => {
    seedDiscount("service_order", 10);
    fake.failNext("orders", "insert", { code: "42703", message: 'column "discount_total" of relation "orders" does not exist' });
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] }, WS.A);
    expect(order.total_price).toBe(90);
    const inserts = fake.requests.filter((item) => item.table === "orders" && item.op === "insert");
    expect(inserts).toHaveLength(2);
    expect(inserts[1].values).not.toHaveProperty("discount_total");
  });

  it("fails loudly (and creates no order) when the product discount cannot be written: RPC missing, table SELECT-only", async () => {
    seedDiscount("service_order", 10);
    seedDiscount("product_order", 50);
    const ordersBefore = fake.all("orders").length;
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [brakePads] }, WS.A)).rejects.toThrow(/crm_set_order_line_discounts|20261101070000/);
    // nothing is left behind with a total that differs from the previewed one
    expect(fake.all("orders")).toHaveLength(ordersBefore);
    // and the failure is not cached: the next attempt reports the same clear error instead of saving silently
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [brakePads] }, WS.A)).rejects.toThrow(/crm_set_order_line_discounts|20261101070000/);
  });

  it("stamps the product discount through crm_set_order_line_discounts and saves the net total", async () => {
    installOrderLineDiscountsRpc();
    fake.signInAs(USERS.manager.id);
    seedDiscount("service_order", 10);
    seedDiscount("product_order", 50);
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [brakePads] }, WS.A);

    const rpcCalls = fake.requests.filter((item) => item.table === "crm_set_order_line_discounts" && item.op === "rpc");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].values).toMatchObject({ p_order_id: order.id, p_lines: [{ discount_type: "percent", discount_value: 50 }] });
    expect(fake.all("order_materials").find((line) => line.order_id === order.id)).toMatchObject({ discount_type: "percent", discount_value: 50 });
    // services 100 - 10 = 90, materials 24 - 12 = 12 -> 102; discount 10 + 12
    expect(row("orders", String(order.id))).toMatchObject({ total_price: 102, discount_total: 22 });
    const loaded = (await getOrders(WS.A)).find((item) => item.id === order.id);
    expect(loaded?.materials?.[0]).toMatchObject({ discountType: "percent", discountValue: 50 });
    expect(loaded).toMatchObject({ totalPrice: 102, discountTotal: 22, subtotal: 124 });
  });

  it("does not call the RPC when the client has no product discount", async () => {
    installOrderLineDiscountsRpc();
    fake.signInAs(USERS.manager.id);
    seedDiscount("service_order", 10);
    await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [brakePads] }, WS.A);
    expect(fake.requests.filter((item) => item.table === "crm_set_order_line_discounts")).toHaveLength(0);
  });

  it("a plain member without orders.edit gets the RPC permission error, not a silent downgrade", async () => {
    installOrderLineDiscountsRpc();
    seedDiscount("product_order", 50);
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [brakePads] }, WS.A)).rejects.toThrow(/permission to edit order discounts/);
  });

  it("surfaces an RPC business error instead of degrading", async () => {
    installOrderLineDiscountsRpc();
    fake.signInAs(USERS.manager.id);
    seedDiscount("product_order", 50);
    fake.failNext("crm_set_order_line_discounts", "rpc", { code: "42501", message: "You do not have permission to edit order discounts." });
    await expect(createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [brakePads] }, WS.A)).rejects.toThrow(/permission to edit order discounts/);
  });
});

describe("updateOrder keeps and recomputes discounts", () => {
  it("keeps saved line discounts by id and stamps only NEW lines", async () => {
    seedDiscount("service_order", 10);
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] }, WS.A);
    const orderId = String(created.id);
    const saved = (await getOrders(WS.A)).find((item) => item.id === orderId)!;
    // The client discount changes later: the saved line must not be re-stamped.
    fake.all("client_discounts").splice(0, fake.all("client_discounts").length);
    seedDiscount("service_order", 25);

    const updated = await updateOrder({ ...details, orderId, services: [saved.services[0], brakeCheck], materials: [] }, WS.A);

    expect(linesOf(orderId).map((line) => [line.service_name, line.discount_type, line.discount_value])).toEqual([
      ["Oil change", "percent", 10],
      ["Brake check", "percent", 25],
    ]);
    // 100 - 10 + 100 - 25 = 165
    expect(row("orders", orderId)).toMatchObject({ total_price: 165, discount_total: 35 });
    expect(updated).toMatchObject({ totalPrice: 165, discountTotal: 35, subtotal: 200 });
  });

  it("re-writes the net total after the materials RPC reset it to gross", async () => {
    seedDiscount("service_order", 10);
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] }, WS.A);
    const orderId = String(created.id);
    const saved = (await getOrders(WS.A)).find((item) => item.id === orderId)!;

    await updateOrder({ ...details, orderId, services: saved.services, materials: [brakePads] }, WS.A);
    // service 100 - 10 = 90, material 12 * 2 = 24 (no product discount configured)
    expect(row("orders", orderId)).toMatchObject({ total_price: 114, discount_total: 10 });
  });

  it("stamps only NEW material lines through the RPC on update", async () => {
    installOrderLineDiscountsRpc();
    fake.signInAs(USERS.manager.id);
    seedDiscount("product_order", 50);
    fake.all("inventory_items").push({ id: "item-a2", workspace_id: WS.A, name: "Alpha oil", sku: "AO-1", quantity: 9, min_quantity: 1, unit: "pcs", purchase_price: 3, selling_price: 5, is_active: true, created_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" });
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [brakePads] }, WS.A);
    const orderId = String(created.id);
    const saved = (await getOrders(WS.A)).find((item) => item.id === orderId)!;
    const before = fake.requests.filter((item) => item.table === "crm_set_order_line_discounts").length;

    await updateOrder({ ...details, orderId, services: saved.services, materials: [...saved.materials!, { inventoryItemId: "item-a2", itemName: "Alpha oil", price: 5, quantity: 1 }] }, WS.A);
    const calls = fake.requests.filter((item) => item.table === "crm_set_order_line_discounts").slice(before);
    expect(calls).toHaveLength(1);
    expect((calls[0].values as { p_lines: unknown[] }).p_lines).toHaveLength(1);
  });

  it("restores the net total and throws when the discount RPC is missing on update", async () => {
    seedDiscount("product_order", 50);
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] }, WS.A);
    const orderId = String(created.id);
    const saved = (await getOrders(WS.A)).find((item) => item.id === orderId)!;

    await expect(updateOrder({ ...details, orderId, services: saved.services, materials: [brakePads] }, WS.A)).rejects.toThrow(/crm_set_order_line_discounts|20261101070000/);
    // sync_order_materials reset total_price to gross; the catch re-wrote the net total of the persisted lines.
    expect(row("orders", orderId)).toMatchObject({ total_price: 124, discount_total: 0 });
  });

  it("removing a discounted line recomputes the totals", async () => {
    seedDiscount("service_order", 10);
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange, brakeCheck] }, WS.A);
    const orderId = String(created.id);
    const saved = (await getOrders(WS.A)).find((item) => item.id === orderId)!;

    await updateOrder({ ...details, orderId, services: [saved.services[1]], materials: [] }, WS.A);
    // Brake check 50 * 2 = 100, 10% = 10
    expect(row("orders", orderId)).toMatchObject({ total_price: 90, discount_total: 10 });
  });

  it("throws when the total update fails instead of leaving a stale total", async () => {
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange] }, WS.A);
    const orderId = String(created.id);
    const saved = (await getOrders(WS.A)).find((item) => item.id === orderId)!;
    // 1st orders update = details, 2nd = totals/summary after the line insert.
    fake.failNext("orders", "update", { code: "PGRST000", message: "totals down" }, 1);
    // Let the details update through: fail only the update that follows.
    const originalTake = fake.takeFailure.bind(fake);
    let updates = 0;
    fake.takeFailure = (table: string, op: string) => {
      if (table === "orders" && op === "update") {
        updates += 1;
        if (updates === 1) return null;
      }
      return originalTake(table, op);
    };
    try {
      await expect(updateOrder({ ...details, orderId, services: [...saved.services, brakeCheck], materials: [] }, WS.A)).rejects.toThrow("totals down");
    } finally {
      fake.takeFailure = originalTake;
    }
  });
});
