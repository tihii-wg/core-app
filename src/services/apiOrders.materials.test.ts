import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelOrder, createOrder, getOrders, updateOrder, updateOrderStatus } from "./apiOrders";
import { createInvoiceFromOrder } from "./apiInvoices";
import { issueOrderMaterials, returnOrderMaterials } from "./apiWarehouse";
import { fake } from "../tests/fakeSupabase";
import { seedCoreApp, USERS, WS, row } from "../tests/coreAppDb";
import { installAddAndIssueOrderCatalogMaterialRpcs, seedWarehouse } from "../tests/orderRpcMocks";

vi.mock("./supabase", async () => ({ default: (await import("../tests/fakeSupabase")).fakeClient }));

const oilChange = { serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 };
const WH = "wh-a1";
const brakePads = { inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 1, warehouseId: WH };

function ensureItemA2(stock = 50) {
  if (!row("inventory_items", "item-a2")) {
    fake.all("inventory_items").push({
      id: "item-a2",
      workspace_id: WS.A,
      name: "Oil filter",
      sku: "OF-1",
      description: null,
      category: "Parts",
      quantity: stock,
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
  } else {
    row("inventory_items", "item-a2")!.quantity = stock;
  }
  if (!fake.all("warehouse_stock").some((row) => row.warehouse_id === WH && row.inventory_item_id === "item-a2")) {
    fake.all("warehouse_stock").push({
      id: `${WH}:item-a2`,
      workspace_id: WS.A,
      warehouse_id: WH,
      inventory_item_id: "item-a2",
      quantity: stock,
    });
  } else {
    const wh = fake.all("warehouse_stock").find((row) => row.warehouse_id === WH && row.inventory_item_id === "item-a2")!;
    wh.quantity = stock;
  }
}

describe("order materials (warehouse-first immediate issue)", () => {
  beforeEach(() => {
    seedCoreApp();
    fake.signInAs(USERS.manager.id);
    installAddAndIssueOrderCatalogMaterialRpcs();
    seedWarehouse(WS.A, WH, { "item-a1": 50 });
    const item = row("inventory_items", "item-a1");
    if (item) item.quantity = 50;
    ensureItemA2(50);
  });

  it("adds catalog materials with immediate deduction; replacement requires return first", async () => {
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

    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 2);
    const loaded = (await getOrders(WS.A)).find((order) => order.id === created.id);
    expect(loaded?.materials).toEqual([
      expect.objectContaining({
        inventoryItemId: "item-a1",
        itemName: "Alpha brake pads",
        price: 12,
        quantity: 2,
        quantityIssued: 2,
        quantityReturned: 0, warehouseId: WH}),
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
    fake.all("warehouse_stock").push({
      id: `${WH}:item-a2`,
      workspace_id: WS.A,
      warehouse_id: WH,
      inventory_item_id: "item-a2",
      quantity: 10,
    });

    await expect(
      updateOrder(
        {
          orderId: String(created.id),
          device: "Car",
          carNumber: "AAA111",
          vin: "",
          description: "",
          assignedEmployeeId: "employee-a1",
          deadline: "",
          materials: [{ inventoryItemId: "item-a2", itemName: "Oil filter", price: 8, quantity: 3, warehouseId: WH }],
        },
        WS.A,
      ),
    ).rejects.toThrow(/already issued|outstanding issued|cannot remove/i);
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

  it("rolls back a newly created order when atomic catalog issue fails", async () => {
    const beforeOrders = fake.all("orders").length;
    const beforeStock = Number(row("inventory_items", "item-a1")?.quantity);

    const { ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC } = await import("./apiOrderMaterialStock");
    const original = fake.rpcs[ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC];
    fake.rpcs[ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC] = () => ({
      data: null,
      error: { code: "P0001", message: "Inventory item is unavailable in this workspace" },
    });

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

    fake.rpcs[ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC] = original;
    expect(fake.all("orders")).toHaveLength(beforeOrders);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(beforeStock);
  });

  it("deleting an order does not automatically restore already-issued stock", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Delete Me", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] },
      WS.A,
    );
    const afterCreate = Number(row("inventory_items", "item-a1")?.quantity);

    const deleteResult = await fake.client.from("orders").delete().eq("id", created.id);
    // Fake may block delete while issued qty is outstanding — stock must still stay deducted.
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(afterCreate);
    if (!deleteResult.error) {
      expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(0);
    }
  });

  it("does not change stock on cancel or reopen", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Status Car", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] },
      WS.A,
    );
    const stock = Number(row("inventory_items", "item-a1")?.quantity);

    // Ordinary status writes cannot cancel — use the protected cancel_order RPC (no inventory side effects).
    fake.rpcs.cancel_order = (args) => {
      const orderId = String(args.p_order_id ?? "");
      const order = row("orders", orderId);
      if (!order || order.workspace_id !== args.p_workspace_id) {
        return { data: null, error: { message: "order_lifecycle:order_not_found", code: "P0002" } };
      }
      order.status = "cancelled";
      return { data: { ok: true, idempotent: false, closed_at: null }, error: null };
    };

    await cancelOrder(String(created.id), WS.A);
    expect(row("orders", String(created.id))?.status).toBe("cancelled");
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
          materials: [{ inventoryItemId: "item-b1", itemName: "Beta filter", price: 12, quantity: 1, warehouseId: WH}],
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

    expect(updated.materials).toEqual([
      expect.objectContaining({ inventoryItemId: "item-a1", quantity: 1, quantityIssued: 1 }),
    ]);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(stock);
  });

  it("editing an order without changing materials does not call sync_order_materials", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "No Mat Change", services: [oilChange], materials: [{ ...brakePads, quantity: 2 }] },
      WS.A,
    );
    const beforeRpc = fake.requests.filter((request) => request.table === "sync_order_materials" && request.op === "rpc").length;
    const existing = fake.all("order_materials").filter((line) => line.order_id === created.id);

    await updateOrder(
      {
        orderId: String(created.id),
        device: "No Mat Change",
        carNumber: "AAA111",
        vin: "",
        description: "desc only",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: existing.map((line) => ({
          id: String(line.id),
          inventoryItemId: String(line.inventory_item_id),
          itemName: String(line.item_name),
          price: Number(line.price),
          quantity: Number(line.quantity), warehouseId: WH})),
      },
      WS.A,
    );

    const afterRpc = fake.requests.filter((request) => request.table === "sync_order_materials" && request.op === "rpc").length;
    expect(afterRpc).toBe(beforeRpc);
    expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(1);
  });

  it("adds a material while preserving existing materials and other orders", async () => {
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

    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Add Mat", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] },
      WS.A,
    );
    const other = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Other order",
        services: [oilChange],
        materials: [{ inventoryItemId: "item-a2", itemName: "Oil filter", price: 8, quantity: 1, warehouseId: WH}],
      },
      WS.A,
    );
    const foreignBefore = fake.all("order_materials").filter((line) => line.order_id === "order-c1").length;

    const updated = await updateOrder(
      {
        orderId: String(created.id),
        device: "Add Mat",
        carNumber: "AAA111",
        vin: "",
        description: "",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: [
          { ...brakePads, quantity: 1 },
          { inventoryItemId: "item-a2", itemName: "Oil filter", price: 8, quantity: 2, warehouseId: WH},
        ],
      },
      WS.A,
    );

    expect(updated.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryItemId: "item-a1", quantity: 1, quantityIssued: 1 }),
        expect.objectContaining({ inventoryItemId: "item-a2", quantity: 2, quantityIssued: 2 }),
      ]),
    );
    expect(updated.materials).toHaveLength(2);
    expect(fake.all("order_materials").filter((line) => line.order_id === other.id)).toEqual([
      expect.objectContaining({ inventory_item_id: "item-a2", quantity: 1 }),
    ]);
    expect(fake.all("order_materials").filter((line) => line.order_id === "order-c1")).toHaveLength(foreignBefore);
  });

  it("updates one material quantity without dropping sibling lines", async () => {
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Update Mat",
        services: [oilChange],
        materials: [
          { ...brakePads, quantity: 1 },
          { inventoryItemId: "item-a2", itemName: "Oil filter", price: 8, quantity: 2, warehouseId: WH },
        ],
      },
      WS.A,
    );

    const updated = await updateOrder(
      {
        orderId: String(created.id),
        device: "Update Mat",
        carNumber: "AAA111",
        vin: "",
        description: "",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: [
          { ...brakePads, quantity: 3 },
          { inventoryItemId: "item-a2", itemName: "Oil filter", price: 8, quantity: 2, warehouseId: WH },
        ],
      },
      WS.A,
    );

    expect(updated.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryItemId: "item-a1", quantity: 3, quantityIssued: 3 }),
        expect.objectContaining({ inventoryItemId: "item-a2", quantity: 2, quantityIssued: 2 }),
      ]),
    );
    expect(updated.materials).toHaveLength(2);
  });

  it("removes one material while keeping the rest and never touching another workspace", async () => {
    // Seed both lines as request-only so the removed line has zero issue history and can be deleted.
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Remove Mat", services: [oilChange], materials: [] },
      WS.A,
    );
    const { error: syncErr } = await fake.client.rpc("sync_order_materials", {
      p_order_id: created.id,
      p_materials: [
        { inventory_item_id: "item-a1", quantity: 1 },
        { inventory_item_id: "item-a2", quantity: 2 },
      ],
    });
    expect(syncErr).toBeNull();
    const foreignMaterials = fake.all("order_materials").filter((line) => line.order_id === "order-c1");

    const updated = await updateOrder(
      {
        orderId: String(created.id),
        device: "Remove Mat",
        carNumber: "AAA111",
        vin: "",
        description: "",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: [{ inventoryItemId: "item-a2", itemName: "Oil filter", price: 8, quantity: 2, warehouseId: WH }],
      },
      WS.A,
    );

    expect(updated.materials).toEqual([expect.objectContaining({ inventoryItemId: "item-a2", quantity: 2, quantityIssued: 2 })]);
    expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(1);
    expect(fake.all("order_materials").filter((line) => line.order_id === "order-c1")).toEqual(foreignMaterials);
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
        materials: [{ inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 1, warehouseId: WH}],
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
    installAddAndIssueOrderCatalogMaterialRpcs();
    seedWarehouse(WS.A, WH, { "item-a1": 100 });
    const item = row("inventory_items", "item-a1");
    if (item) item.quantity = 100;
  });

  /** Request-only catalog lines via sync (issued=0) so legacy issue/return RPCs can be tested. */
  async function orderWithMaterials(quantity = 5) {
    row("inventory_items", "item-a1")!.quantity = Math.max(Number(row("inventory_items", "item-a1")!.quantity), quantity + 10);
    const wh = fake.all("warehouse_stock").find((row) => row.warehouse_id === WH && row.inventory_item_id === "item-a1");
    if (wh) wh.quantity = Math.max(Number(wh.quantity), quantity + 10);
    const order = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Warehouse Car",
        services: [oilChange],
        materials: [],
      },
      WS.A,
    );
    const { error } = await fake.client.rpc("sync_order_materials", {
      p_order_id: order.id,
      p_materials: [{ inventory_item_id: "item-a1", quantity }],
    });
    if (error) throw new Error(error.message);
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

  it("increasing catalog quantity on update issues only the additional amount", async () => {
    const order = await orderWithMaterials(3);
    expect(fake.all("inventory_movements")).toHaveLength(0);
    const before = Number(row("inventory_items", "item-a1")?.quantity);

    await updateOrder(
      {
        orderId: String(order),
        device: "Warehouse Car",
        carNumber: "AAA111",
        vin: "",
        description: "",
        assignedEmployeeId: "employee-a1",
        deadline: "",
        materials: [{ inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 4, warehouseId: WH }],
      },
      WS.A,
    );

    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(before - 4);
    expect(fake.all("inventory_movements").some((row) => row.movement_type === "issue")).toBe(true);
    const refreshed = (await getOrders(WS.A)).find((item) => item.id === order);
    expect(refreshed?.materials?.[0]).toEqual(
      expect.objectContaining({ quantity: 4, quantityIssued: 4, quantityReturned: 0 }),
    );
  });

  it("rejects invalid payloads", async () => {
    const order = await orderWithMaterials(2);
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 0 }], "bad-0")).rejects.toThrow();
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "item-a1", quantity: 1.5 }], "bad-frac")).rejects.toThrow();
    await expect(issueOrderMaterials(order, [{ inventoryItemId: "not-a-uuid", quantity: 1 }], "bad-id")).rejects.toThrow();
  });
});

describe("sync_order_materials security and correctness (fake RPC mirror)", () => {
  beforeEach(() => {
    seedCoreApp();
    fake.signInAs(USERS.manager.id);
    installAddAndIssueOrderCatalogMaterialRpcs();
    seedWarehouse(WS.A, WH, { "item-a1": 50 });
    const item = row("inventory_items", "item-a1");
    if (item) item.quantity = 50;
  });

  async function rpc(orderId: string, materials: unknown) {
    return fake.client.rpc("sync_order_materials", { p_order_id: orderId, p_materials: materials });
  }

  it("rejects null order id, nonexistent order, and unauthorized workspace", async () => {
    expect((await rpc("", [])).error?.message).toMatch(/order_id is required/i);
    expect((await rpc("missing-order", [])).error?.message).toMatch(/not found|permission/i);

    fake.signInAs(USERS.outsider.id);
    expect((await rpc("order-a1", [{ inventory_item_id: "item-a1", quantity: 1 }])).error?.message).toMatch(
      /not found|permission/i,
    );
  });

  it("rejects null/non-array payload and invalid quantities/prices/sources", async () => {
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "X", services: [oilChange] }, WS.A);
    const id = String(order.id);

    expect((await rpc(id, null)).error?.message).toMatch(/JSON array/i);
    expect((await rpc(id, { inventory_item_id: "item-a1", quantity: 1 })).error?.message).toMatch(/JSON array/i);
    expect((await rpc(id, [{ inventory_item_id: "item-a1", quantity: 0 }])).error?.message).toMatch(/greater than 0/i);
    expect((await rpc(id, [{ inventory_item_id: "item-a1", quantity: 1.5 }])).error?.message).toMatch(/whole number/i);
    expect((await rpc(id, [{ inventory_item_id: "item-a1", quantity: 2147483648 }])).error?.message).toMatch(/too large/i);
    expect((await rpc(id, [{ inventory_item_id: "item-a1", quantity: 1, supply_source: "warehouse" }])).error?.message).toMatch(
      /supply_source/i,
    );
    expect(
      (await rpc(id, [{ item_name: "Seal", price: -1, quantity: 1, supply_source: "one_time" }])).error?.message,
    ).toMatch(/negative/i);
  });

  it("rejects catalog items from another workspace and preserves cross-order isolation", async () => {
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "X", services: [oilChange] }, WS.A);
    expect((await rpc(String(order.id), [{ inventory_item_id: "item-b1", quantity: 1 }])).error?.message).toMatch(
      /unavailable/i,
    );

    const foreignBefore = fake.all("order_materials").filter((line) => line.order_id === "order-c1");
    await rpc(String(order.id), [{ inventory_item_id: "item-a1", quantity: 2 }]);
    expect(fake.all("order_materials").filter((line) => line.order_id === "order-c1")).toEqual(foreignBefore);
  });

  it("adds catalog and freeform materials, updates freeform by line_id, and preserves ids on repeat", async () => {
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Mix",
        services: [oilChange],
        materials: [
          { ...brakePads, quantity: 1 },
          { itemName: "Gasket", price: 3, quantity: 1, supplySource: "one_time" },
        ],
      },
      WS.A,
    );
    const first = (await getOrders(WS.A)).find((o) => o.id === created.id)!;
    const freeformId = first.materials?.find((m) => !m.inventoryItemId)?.id;
    expect(freeformId).toBeTruthy();

    const again = await rpc(String(created.id), [
      { inventory_item_id: "item-a1", quantity: 1, supply_source: "catalog" },
      {
        line_id: freeformId,
        inventory_item_id: null,
        item_name: "Gasket HD",
        price: 4,
        quantity: 2,
        supply_source: "one_time",
      },
    ]);
    expect(again.error).toBeNull();
    expect(again.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventory_item_id: "item-a1", quantity: 1 }),
        expect.objectContaining({ id: freeformId, item_name: "Gasket HD", quantity: 2, price: 4 }),
      ]),
    );

    const repeat = await rpc(String(created.id), [
      { inventory_item_id: "item-a1", quantity: 1, supply_source: "catalog" },
      {
        line_id: freeformId,
        inventory_item_id: null,
        item_name: "Gasket HD",
        price: 4,
        quantity: 2,
        supply_source: "one_time",
      },
    ]);
    expect(repeat.error).toBeNull();
    expect((repeat.data as { id: string }[]).map((row) => row.id).sort()).toEqual(
      (again.data as { id: string }[]).map((row) => row.id).sort(),
    );
  });

  it("rejects converting freeform lines to catalog via inventory_item_id", async () => {
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Conv",
        services: [oilChange],
        materials: [{ itemName: "Gasket", price: 3, quantity: 1, supplySource: "one_time" }],
      },
      WS.A,
    );
    const freeformId = fake.all("order_materials").find((line) => line.order_id === created.id)?.id;
    expect(
      (
        await rpc(String(created.id), [
          {
            line_id: freeformId,
            inventory_item_id: "item-a1",
            item_name: "Gasket",
            price: 3,
            quantity: 1,
            supply_source: "one_time",
          },
        ])
      ).error?.message,
    ).toMatch(/must not include inventory_item_id|Invalid/i);
  });

  it("rejects converting catalog lines to freeform and foreign line ids", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "Guard", services: [oilChange], materials: [{ ...brakePads, quantity: 1 }] },
      WS.A,
    );
    const catalogLine = fake.all("order_materials").find((line) => line.order_id === created.id)!;

    expect(
      (
        await rpc(String(created.id), [
          {
            line_id: String(catalogLine.id),
            item_name: "Hacked",
            price: 1,
            quantity: 1,
            supply_source: "one_time",
          },
        ])
      ).error?.message,
    ).toMatch(/catalog material|Invalid line_id/i);

    expect(
      (
        await rpc(String(created.id), [
          { line_id: "line-c1", item_name: "Foreign", price: 1, quantity: 1, supply_source: "one_time" },
        ])
      ).error?.message,
    ).toMatch(/Invalid line_id/i);
  });

  it("removes unissued materials, blocks outstanding issued, preserves fully returned history in totals", async () => {
    row("inventory_items", "item-a1")!.quantity = Math.max(Number(row("inventory_items", "item-a1")!.quantity), 20);
    // Request-only via sync so we control issue/return separately from createOrder.
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Hist", services: [oilChange], materials: [] }, WS.A);
    const orderId = String(created.id);
    expect((await rpc(orderId, [{ inventory_item_id: "item-a1", quantity: 2 }])).error).toBeNull();
    const beforeStock = Number(row("inventory_items", "item-a1")?.quantity);

    await issueOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 2 }], "iss");
    expect((await rpc(orderId, [])).error?.message).toMatch(/outstanding issued/i);

    await returnOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 2 }], undefined, "ret");
    const cleared = await rpc(orderId, []);
    // Fully returned lines keep issue/return history → retained (issued>0 or returned>0).
    expect(cleared.error).toBeNull();
    const remaining = fake.all("order_materials").filter((line) => line.order_id === orderId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ quantity_issued: 2, quantity_returned: 2, quantity: 2 });
    expect(Number(row("orders", orderId)?.total_price)).toBe(40 + 12 * 2);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(beforeStock);

    const fresh = await createOrder({ clientId: "client-a1", clientName: "", device: "Clear", services: [oilChange], materials: [] }, WS.A);
    expect((await rpc(String(fresh.id), [{ inventory_item_id: "item-a1", quantity: 1 }])).error).toBeNull();
    expect((await rpc(String(fresh.id), [])).error).toBeNull();
    expect(fake.all("order_materials").filter((line) => line.order_id === fresh.id)).toHaveLength(0);
  });

  it("rejects duplicate catalog ids in payload and rolls back on mid-sync validation failure", async () => {
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Dup", services: [oilChange] }, WS.A);
    const dup = await rpc(String(created.id), [
      { inventory_item_id: "item-a1", quantity: 2 },
      { inventory_item_id: "item-a1", quantity: 3 },
    ]);
    expect(dup.error?.message).toMatch(/Duplicate catalog inventory_item_id/i);
    expect(fake.all("order_materials").filter((line) => line.order_id === created.id)).toHaveLength(0);

    const ok = await rpc(String(created.id), [{ inventory_item_id: "item-a1", quantity: 2 }]);
    expect(ok.error).toBeNull();

    const before = cloneMaterials(String(created.id));
    const failed = await rpc(String(created.id), [
      { inventory_item_id: "item-a1", quantity: 1 },
      { inventory_item_id: "item-b1", quantity: 1 },
    ]);
    expect(failed.error?.message).toMatch(/unavailable/i);
    expect(cloneMaterials(String(created.id))).toEqual(before);
  });

  it("empty array clears only zero-history lines and recomputes totals from services alone", async () => {
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Empty", services: [oilChange], materials: [] }, WS.A);
    const orderId = String(created.id);
    expect((await rpc(orderId, [{ inventory_item_id: "item-a1", quantity: 2 }])).error).toBeNull();
    expect(Number(row("orders", orderId)?.total_price)).toBe(64);
    expect((await rpc(orderId, [])).error).toBeNull();
    expect(fake.all("order_materials").filter((line) => line.order_id === orderId)).toHaveLength(0);
    expect(Number(row("orders", orderId)?.total_price)).toBe(40);
  });

  it("rejects empty and malformed line_id / inventory_item_id (never coerces to NULL)", async () => {
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Ids", services: [oilChange] }, WS.A);
    const id = String(created.id);

    for (const bad of ["", "   ", 0, true, false, [], { a: 1 }, "not-a-valid-uuid-shape-!!!!", "550e8400-e29b-41d4-a716-44665544000g"]) {
      expect(
        (await rpc(id, [{ line_id: bad, item_name: "X", price: 1, quantity: 1, supply_source: "one_time" }])).error?.message,
      ).toMatch(/Invalid line_id/i);
      expect((await rpc(id, [{ inventory_item_id: bad, quantity: 1 }])).error?.message).toMatch(/Invalid inventory_item_id/i);
    }

    // JSON null / omitted remain allowed for new freeform lines.
    expect(
      (await rpc(id, [{ line_id: null, item_name: "Fresh", price: 2, quantity: 1, supply_source: "one_time" }])).error,
    ).toBeNull();
    expect(
      (await rpc(id, [{ item_name: "Also fresh", price: 2, quantity: 1, supply_source: "customer" }])).error,
    ).toBeNull();
  });

  it("freezes freeform name/price/source after issue/return history; allows valid qty only", async () => {
    const created = await createOrder(
      {
        clientId: "client-a1",
        clientName: "",
        device: "Freeze",
        services: [oilChange],
        materials: [{ itemName: "Seal", price: 5, quantity: 3, supplySource: "one_time" }],
      },
      WS.A,
    );
    const orderId = String(created.id);
    const line = fake.all("order_materials").find((row) => row.order_id === orderId)!;
    // Warehouse issue RPC is catalog-only; seed history directly to exercise sync guards.
    line.quantity_issued = 2;
    line.quantity_returned = 1;

    expect(
      (
        await rpc(orderId, [
          { line_id: line.id, item_name: "Seal Renamed", price: 5, quantity: 3, supply_source: "one_time" },
        ])
      ).error?.message,
    ).toMatch(/Cannot change material name after issue or return activity/i);

    expect(
      (
        await rpc(orderId, [
          { line_id: line.id, item_name: "Seal", price: 9, quantity: 3, supply_source: "one_time" },
        ])
      ).error?.message,
    ).toMatch(/Cannot change material price after issue or return activity/i);

    expect(
      (
        await rpc(orderId, [
          { line_id: line.id, item_name: "Seal", price: 5, quantity: 3, supply_source: "customer" },
        ])
      ).error?.message,
    ).toMatch(/Cannot change material supply source after issue or return activity/i);

    expect(
      (
        await rpc(orderId, [
          { line_id: line.id, item_name: "Seal", price: 5, quantity: 1, supply_source: "one_time" },
        ])
      ).error?.message,
    ).toMatch(/Requested quantity cannot be less than already issued quantity/i);

    const ok = await rpc(orderId, [
      { line_id: line.id, item_name: "Seal", price: 5, quantity: 4, supply_source: "one_time" },
    ]);
    expect(ok.error).toBeNull();
    expect(row("order_materials", String(line.id))).toMatchObject({
      item_name: "Seal",
      price: 5,
      quantity: 4,
      supply_source: "one_time",
      quantity_issued: 2,
      quantity_returned: 1,
    });
  });

  it("keeps catalog name/price frozen on sync and rejects duplicate catalog rows", async () => {
    const created = await createOrder(
      { clientId: "client-a1", clientName: "", device: "CatHist", services: [oilChange], materials: [{ ...brakePads, quantity: 2 }] },
      WS.A,
    );
    const orderId = String(created.id);
    const catalogLine = fake.all("order_materials").find((row) => row.order_id === orderId)!;
    catalogLine.quantity_issued = 1;
    catalogLine.item_name = "Alpha brake pads";
    catalogLine.price = 12;
    row("inventory_items", "item-a1")!.selling_price = 99;
    row("inventory_items", "item-a1")!.name = "Renamed in catalog";

    const synced = await rpc(orderId, [{ inventory_item_id: "item-a1", quantity: 3, supply_source: "catalog" }]);
    expect(synced.error).toBeNull();
    expect(row("order_materials", String(catalogLine.id))).toMatchObject({
      item_name: "Alpha brake pads",
      price: 12,
      quantity: 3,
      quantity_issued: 1,
    });

    // Simulate legacy duplicate catalog rows (unique index missing / violated offline).
    fake.all("order_materials").push({
      id: "dup-catalog-line",
      order_id: orderId,
      inventory_item_id: "item-a1",
      item_name: "Dup",
      price: 1,
      quantity: 1,
      quantity_issued: 0,
      quantity_returned: 0,
      supply_source: "catalog",
      created_at: new Date().toISOString(),
    });
    expect((await rpc(orderId, [{ inventory_item_id: "item-a1", quantity: 3 }])).error?.message).toMatch(
      /Duplicate catalog material rows/i,
    );
  });

  it("documents established accounting: fully returned retained lines remain in order total", async () => {
    // Established across sync_order_materials since warehouse issue/return: total_price sums
    // ALL remaining order_materials.price*quantity, including fully returned historical rows.
    row("inventory_items", "item-a1")!.quantity = Math.max(Number(row("inventory_items", "item-a1")!.quantity), 20);
    const created = await createOrder({ clientId: "client-a1", clientName: "", device: "Bill", services: [oilChange], materials: [] }, WS.A);
    const orderId = String(created.id);
    expect((await rpc(orderId, [{ inventory_item_id: "item-a1", quantity: 2 }])).error).toBeNull();
    await issueOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 2 }], "bill-iss");
    await returnOrderMaterials(orderId, [{ inventoryItemId: "item-a1", quantity: 2 }], undefined, "bill-ret");

    expect((await rpc(orderId, [])).error).toBeNull();
    expect(fake.all("order_materials").filter((line) => line.order_id === orderId)).toHaveLength(1);
    expect(Number(row("orders", orderId)?.total_price)).toBe(40 + 12 * 2);
  });
});

function cloneMaterials(orderId: string) {
  return fake
    .all("order_materials")
    .filter((line) => line.order_id === orderId)
    .map((line) => ({ ...line }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
