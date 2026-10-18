import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder, getOrders, updateOrder, updateOrderStatus } from "./apiOrders";
import { createInvoiceFromOrder } from "./apiInvoices";
import { issueOrderMaterials, returnOrderMaterials } from "./apiWarehouse";
import { fake } from "../tests/fakeSupabase";
import { seedCoreApp, USERS, WS, row } from "../tests/coreAppDb";

vi.mock("./supabase", async () => ({ default: (await import("../tests/fakeSupabase")).fakeClient }));

const oilChange = { serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 };
const brakePads = { inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 1 };

describe("order materials (request-only)", () => {
  beforeEach(() => {
    seedCoreApp();
    fake.signInAs(USERS.member.id);
  });

  it("adds, edits, and removes requested materials without changing inventory stock", async () => {
    const before = Number(row("inventory_items", "item-a1")?.quantity);
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Car",
        services: [oilChange],
        materials: [{ ...brakePads, quantity: 2 }],
      },
      WS.A,
    );

    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before);
    const loaded = (await getOrders(WS.A)).find((order) => order.id === created.id);
    expect(loaded?.materials).toEqual([
      expect.objectContaining({ inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 2, quantityIssued: 0, quantityReturned: 0 }),
    ]);
    expect(loaded?.totalPrice).toBe(64);

    fake.all("inventory_items").push({
      id: "item-a2",
      workspace_id: WS.A,
      name: "Oil filter",
      sku: "OF-1",
      description: null,
      category: "Parts",
      quantity: 10,
      min_quantity: 1,
      unit: "pcs",
      purchase_price: 5,
      selling_price: 8,
      supplier: null,
      location: null,
      is_active: true,
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    });

    await updateOrder(
      {
        orderId: String(created.id),
        device: "Car",
        carNumber: "AAA111",
        vin: "",
        description: "",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: [{ inventoryItemId: "item-a2", itemName: "Oil filter", price: 8, quantity: 3 }],
      },
      WS.A,
    );
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before);
    expect(Number(row("inventory_items", "item-a2")?.quantity)).toBe(10);

    await updateOrder(
      {
        orderId: String(created.id),
        device: "Car",
        carNumber: "AAA111",
        vin: "",
        description: "",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: [],
      },
      WS.A,
    );
    expect(Number(row("inventory_items", "item-a2")?.quantity)).toBe(10);
    expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(0);
  });

  it("does not change stock when the same materials payload is synced twice", async () => {
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] }, WS.A);
    const qtyAfterCreate = Number(row("inventory_items", "item-a1")?.quantity);

    const { data, error } = await fake.client.rpc("sync_order_materials", {
      p_order_id: order.id,
      p_materials: [{ inventory_item_id: "item-a1", quantity: 1 }],
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(qtyAfterCreate);
  });

  it("rolls back a newly created order when materials sync fails", async () => {
    const beforeOrders = fake.all("orders").length;
    const beforeStock = Number(row("inventory_items", "item-a1")?.quantity);

    const original = fake.rpcs.sync_order_materials;
    fake.rpcs.sync_order_materials = () => ({ data: null, error: { code: "P0001", message: "Inventory item is unavailable in this workspace" } });

    await expect(
      createOrder(
        {
          clientId: "client-a1",
          clientName: "",
          device: "Rollback Car",
          services: [oilChange],
          materials: [{ ...brakePads, quantity: 1 }],
        },
        WS.A,
      ),
    ).rejects.toThrow(/unavailable|material/i);

    fake.rpcs.sync_order_materials = original;
    expect(fake.all("orders")).toHaveLength(beforeOrders);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(beforeStock);
  });

  it("allows deleting an order with request-only materials without changing stock", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Delete Me", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] },
      WS.A,
    );
    const afterCreate = Number(row("inventory_items", "item-a1")?.quantity);

    await fake.client.from("orders").delete().eq("id", created.id);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(afterCreate);
    expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(0);
  });

  it("does not change stock on cancel or reopen", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Status Car", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] },
      WS.A,
    );
    const stock = Number(row("inventory_items", "item-a1")?.quantity);

    await updateOrderStatus(String(created.id), "cancelled", WS.A);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(stock);

    await updateOrderStatus(String(created.id), "in-progress", WS.A);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(stock);
  });

  it("denies direct client writes to order_materials and foreign workspace items", async () => {
    const insert = await fake.client.from("order_materials").insert({
      order_id: "order-a1",
      inventory_item_id: "item-a1",
      item_name: "Hack",
      price: 1,
      quantity: 1,
    });
    expect(insert.error?.message).toMatch(/permission denied/i);

    await expect(
      createOrder(
        {
          clientId: "client-a1",
          clientName: "",
          device: "Foreign",
          services: [oilChange],
          materials: [{ inventoryItemId: "item-b1", itemName: "Beta filter", price: 12, quantity: 1 }],
        },
        WS.A,
      ),
    ).rejects.toThrow(/unavailable|material/i);
  });

  it("omitting materials on update preserves existing lines", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Keep Mats", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] },
      WS.A,
    );
    const stock = Number(row("inventory_items", "item-a1")?.quantity);

    const updated = await updateOrder(
      {
        orderId: String(created.id),
        device: "Keep Mats",
        carNumber: "AAA111",
        vin: "",
        description: "updated",
        assignedEmployeeId: "employee-a1",
        deadline: "",
      },
      WS.A,
    );

    expect(updated.materials).toEqual([expect.objectContaining({ inventoryItemId: "item-a1", quantity: 1 })]);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(stock);
  });

  it("includes materials on invoices with null service_id and frozen snapshots", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Invoice Car", services: [oilChange], materials: [{ ...brakePads, quantity: 2 }] },
      WS.A,
    );
    const materialOnly = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Parts only",
        services: [oilChange],
        materials: [{ inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 1 }],
      },
      WS.A,
    );

    row("inventory_items", "item-a1")!.name = "Renamed pads";
    row("inventory_items", "item-a1")!.selling_price = 999;

    const invoice = await createInvoiceFromOrder(String(created.id), WS.A);
    expect(invoice.items).toEqual([
      expect.objectContaining({ serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }),
      expect.objectContaining({ serviceId: null, serviceName: "Alpha brake pads", price: 12, quantity: 2 }),
    ]);
    expect(invoice.total).toBe(64);

    fake.tables.order_services = fake.all("order_services").filter((line) => line.order_id !== materialOnly.id);
    const materialInvoice = await createInvoiceFromOrder(String(materialOnly.id), WS.A);
    expect(materialInvoice.items).toEqual([expect.objectContaining({ serviceId: null, serviceName: "Alpha brake pads", price: 12, quantity: 1 })]);
  });

  it("creates an order without calling materials sync when the list is empty", async () => {
    const before = fake.requests.filter((item) => item.table === "sync_order_materials" && item.op === "rpc").length;
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "No Parts", services: [oilChange], materials: [] },
      WS.A,
    );
    expect(created).toMatchObject({ device: "No Parts" });
    expect(fake.requests.filter((item) => item.table === "sync_order_materials" && item.op === "rpc")).toHaveLength(before);
    expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(0);
  });

  it("does not sync fractional material quantities and leaves stock unchanged", async () => {
    const beforeStock = Number(row("inventory_items", "item-a1")?.quantity);
    const beforeSyncCalls = fake.requests.filter((item) => item.table === "sync_order_materials" && item.op === "rpc").length;
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Oil Car",
        services: [oilChange],
        materials: [{ ...brakePads, quantity: 1.5 }],
      },
      WS.A,
    );
    expect(fake.requests.filter((item) => item.table === "sync_order_materials" && item.op === "rpc")).toHaveLength(beforeSyncCalls);
    expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(0);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(beforeStock);
  });
});

describe("warehouse issue and return", () => {
  beforeEach(() => {
    seedCoreApp();
    fake.signInAs(USERS.manager.id);
  });

  async function orderWithMaterials(quantity = 5) {
    row("inventory_items", "item-a1")!.quantity = Math.max(Number(row("inventory_items", "item-a1")!.quantity), quantity + 10);
    fake.signInAs(USERS.member.id);
    const order = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Warehouse Car",
        services: [oilChange],
        materials: [{ ...brakePads, quantity }],
      },
      WS.A,
    );
    fake.signInAs(USERS.manager.id);
    return String(order.id);
  }

  it("partial issuance decreases stock by exactly the issued amount", async () => {
    const order = await orderWithMaterials(5);
    const before = Number(row("inventory_items", "item-a1")?.quantity);

    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 3 }], "issue-1");
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 3);
    const line = fake.all("order_materials").find((row) => row.order_id === order)!;
    expect(Number(line.quantity_issued)).toBe(3);
    expect(fake.all("inventory_movements")).toHaveLength(1);
  });

  it("multiple issuance operations respect the remaining requested quantity", async () => {
    const order = await orderWithMaterials(5);
    const before = Number(row("inventory_items", "item-a1")?.quantity);

    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 3 }], "issue-a");
    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], "issue-b");
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 5);

    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "issue-c")).rejects.toThrow(/remaining requested/i);
  });

  it("fails issuance when stock is insufficient with no partial database changes", async () => {
    const order = await orderWithMaterials(5);
    row("inventory_items", "item-a1")!.quantity = 1;
    const materialsBefore = structuredClone(fake.all("order_materials"));
    const movementsBefore = fake.all("inventory_movements").length;

    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], "issue-fail")).rejects.toThrow(/stock/i);

    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(1);
    expect(fake.all("order_materials")).toEqual(materialsBefore);
    expect(fake.all("inventory_movements")).toHaveLength(movementsBefore);
  });

  it("successful return increases stock by exactly the accepted quantity", async () => {
    const order = await orderWithMaterials(5);
    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 5 }], "issue-all");
    const afterIssue = Number(row("inventory_items", "item-a1")?.quantity);

    await returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "leftover", "return-1");
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(afterIssue + 1);
    const line = fake.all("order_materials").find((row) => row.order_id === order)!;
    expect(Number(line.quantity_returned)).toBe(1);
  });

  it("returns cannot exceed issued quantities minus previous returns", async () => {
    const order = await orderWithMaterials(5);
    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 3 }], "issue-3");
    await returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], undefined, "return-1");

    await expect(returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 3 }], undefined, "return-over")).rejects.toThrow(
      /outstanding issued/i,
    );
  });

  it("repeated requests with the same idempotency key do not duplicate stock movements", async () => {
    const order = await orderWithMaterials(5);
    const before = Number(row("inventory_items", "item-a1")?.quantity);

    const first = await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], "same-key");
    const second = await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], "same-key");

    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 2);
    expect(fake.all("inventory_movements").filter((row) => row.idempotency_key === "same-key")).toHaveLength(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const order = await orderWithMaterials(5);
    const before = Number(row("inventory_items", "item-a1")?.quantity);

    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], "reuse-key");
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "reuse-key")).rejects.toThrow(/idempotency key/i);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 2);
    expect(fake.all("inventory_movements").filter((row) => row.idempotency_key === "reuse-key")).toHaveLength(1);
  });

  it("rejects idempotency key reuse across orders in the same workspace", async () => {
    const orderA = await orderWithMaterials(2);
    const orderB = await orderWithMaterials(2);
    await issueOrderMaterials(orderA, [{ inventoryItemId: "item-a1", quantity: 1 }], "shared-key");
    await expect(issueOrderMaterials(orderB, [{ inventoryItemId: "item-a1", quantity: 1 }], "shared-key")).rejects.toThrow(/idempotency key/i);
  });

  it("exact return retries match reason; different reason is rejected", async () => {
    const order = await orderWithMaterials(3);
    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], "issue-ret");
    const first = await returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "leftover", "ret-key");
    const second = await returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "leftover", "ret-key");
    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
    await expect(returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "other", "ret-key")).rejects.toThrow(/idempotency key/i);
  });

  it("rejects duplicate inventory_item_id values in one payload", async () => {
    const order = await orderWithMaterials(5);
    const before = Number(row("inventory_items", "item-a1")?.quantity);
    await expect(
      issueOrderMaterials(
        order,
        [
          { inventoryItemId: "item-a1", quantity: 1 },
          { inventoryItemId: "item-a1", quantity: 1 },
        ],
        "dup-lines",
      ),
    ).rejects.toThrow(/duplicate inventory_item_id/i);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before);
    expect(fake.all("inventory_movements")).toHaveLength(0);
  });

  it("rejects cross-workspace inventory item references", async () => {
    const order = await orderWithMaterials(2);
    const line = fake.all("order_materials").find((row) => row.order_id === order)!;
    line.inventory_item_id = "item-b1";
    const beforeA = Number(row("inventory_items", "item-a1")?.quantity);
    const beforeB = Number(row("inventory_items", "item-b1")?.quantity);

    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-b1", quantity: 1 }], "xws")).rejects.toThrow(/unavailable/i);

    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(beforeA);
    expect(Number(row("inventory_items", "item-b1")?.quantity)).toBe(beforeB);
    expect(fake.all("inventory_movements")).toHaveLength(0);
  });

  it("concurrent issuance cannot overdraw inventory", async () => {
    const order = await orderWithMaterials(1);
    row("inventory_items", "item-a1")!.quantity = 1;

    const results = await Promise.allSettled([
      issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "c1"),
      issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "c2"),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(0);
  });

  it("concurrent returns cannot over-return material", async () => {
    const order = await orderWithMaterials(2);
    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "issue-once");

    const results = await Promise.allSettled([
      returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], undefined, "r1"),
      returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], undefined, "r2"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const line = fake.all("order_materials").find((row) => row.order_id === order)!;
    expect(Number(line.quantity_returned)).toBe(1);
  });

  it("rejects unauthorized issuance and returns", async () => {
    const order = await orderWithMaterials(2);
    fake.signInAs(USERS.member.id);

    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "m1")).rejects.toThrow(/permission/i);
    await expect(returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], undefined, "m2")).rejects.toThrow(/permission/i);
  });

  it("rejects cross-workspace issuance", async () => {
    const order = await orderWithMaterials(1);
    fake.signInAs(USERS.outsider.id);
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1 }], "x1")).rejects.toThrow(/permission/i);
  });

  it("order deletion does not restore issued stock and is blocked while outstanding", async () => {
    const order = await orderWithMaterials(2);
    const before = Number(row("inventory_items", "item-a1")?.quantity);
    await issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], "issue-del");
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 2);

    const blocked = await fake.client.from("orders").delete().eq("id", order);
    expect(blocked.error?.message).toMatch(/outstanding issued/i);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 2);

    await returnOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 2 }], undefined, "return-all");
    const deleted = await fake.client.from("orders").delete().eq("id", order);
    expect(deleted.error).toBeNull();
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before);
  });

  it("editing requested materials does not invent movement history", async () => {
    const order = await orderWithMaterials(3);
    expect(fake.all("inventory_movements")).toHaveLength(0);

    await updateOrder(
      {
        orderId: String(order),
        device: "Warehouse Car",
        carNumber: "AAA111",
        vin: "",
        description: "",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: [{ inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 4 }],
      },
      WS.A,
    );

    expect(fake.all("inventory_movements")).toHaveLength(0);
    const refreshed = (await getOrders(WS.A)).find((item) => item.id === order);
    expect(refreshed?.materials?.[0]).toEqual(expect.objectContaining({ quantity: 4, quantityIssued: 0, quantityReturned: 0 }));
  });

  it("rejects invalid payloads", async () => {
    const order = await orderWithMaterials(2);
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 0 }], "bad-0")).rejects.toThrow();
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1.5 }], "bad-frac")).rejects.toThrow();
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "not-a-uuid", quantity: 1 }], "bad-id")).rejects.toThrow();
  });
});
