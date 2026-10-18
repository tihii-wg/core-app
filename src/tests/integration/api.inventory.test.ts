import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInventoryItem, deleteInventoryItem, getInventoryItem, getInventoryItems, updateInventoryItem } from "../../services/apiInventory";
import { getInventoryMarkup, updateInventoryMarkup } from "../../services/apiInventoryMarkup";
import { issueOrderMaterials, returnOrderMaterials } from "../../services/apiWarehouse";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const form = { name: " Spark plug ", sku: " SP-1 ", description: "", category: "Parts", quantity: 8, minQuantity: 2, unit: "pcs", purchasePrice: 3, sellingPrice: 5, supplier: "", location: "", isActive: true };
const sortByName = { field: "name" as const, ascending: true };

beforeEach(() => {
  seedCoreApp();
  fake.signInAs(USERS.member.id);
});

describe("inventory items", () => {
  it("creates an item with trimmed fields and a computed stock status", async () => {
    const item = await createInventoryItem(form, WS.A);
    expect(item).toMatchObject({ name: "Spark plug", sku: "SP-1", workspaceId: WS.A, stockStatus: "in_stock", supplier: "", minQuantity: 2 });
    expect(row("inventory_items", item.id)).toMatchObject({ supplier: null, workspace_id: WS.A, min_quantity: 2 });
  });

  it("defaults minQuantity to 10 when the create payload omits a valid minimum", async () => {
    const beforeSeedMin = row("inventory_items", "item-a1")?.min_quantity;
    const item = await createInventoryItem({ ...form, sku: "DEF-10", minQuantity: Number.NaN }, WS.A);
    expect(item).toMatchObject({ minQuantity: 10, stockStatus: "low_stock" }); // qty 8 <= min 10
    expect(row("inventory_items", item.id)?.min_quantity).toBe(10);
    expect(row("inventory_items", "item-a1")?.min_quantity).toBe(beforeSeedMin);
  });

  it("keeps an explicit minimum of 0 (alerts only when empty)", async () => {
    const item = await createInventoryItem({ ...form, sku: "MIN-0", quantity: 5, minQuantity: 0 }, WS.A);
    expect(item).toMatchObject({ minQuantity: 0, quantity: 5, stockStatus: "in_stock" });
    expect(row("inventory_items", item.id)?.min_quantity).toBe(0);
  });

  it("maps a duplicate SKU in the same workspace to a readable message", async () => {
    await expect(createInventoryItem({ ...form, sku: "AP-1" }, WS.A)).rejects.toThrow("An inventory item with this SKU already exists.");
  });

  it("allows the same SKU in another workspace", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(createInventoryItem({ ...form, sku: "AP-1" }, WS.B)).resolves.toMatchObject({ workspaceId: WS.B });
  });

  it("maps an RLS denial to the permission message", async () => {
    await expect(createInventoryItem(form, WS.C)).rejects.toThrow("You do not have permission to change inventory in this workspace.");
  });

  it("lists one workspace, with search, stock filters, inactive filter and sorting", async () => {
    await createInventoryItem(form, WS.A);
    await createInventoryItem({ ...form, name: "Old bulb", sku: "OB-1", quantity: 0, isActive: false }, WS.A);

    expect((await getInventoryItems("", "all", sortByName, WS.A)).map((item) => item.name)).toEqual(["Alpha brake pads", "Old bulb", "Spark plug"]);
    expect((await getInventoryItems("", "all", { field: "quantity", ascending: false }, WS.A)).map((item) => item.name)).toEqual(["Spark plug", "Alpha brake pads", "Old bulb"]);
    expect((await getInventoryItems("spark", "all", sortByName, WS.A)).map((item) => item.name)).toEqual(["Spark plug"]);
    expect((await getInventoryItems("", "low_stock", sortByName, WS.A)).map((item) => item.name)).toEqual(["Alpha brake pads"]);
    expect((await getInventoryItems("", "out_of_stock", sortByName, WS.A)).map((item) => item.name)).toEqual(["Old bulb"]);
    expect((await getInventoryItems("", "inactive", sortByName, WS.A)).map((item) => item.name)).toEqual(["Old bulb"]);
    expect(await getInventoryItems("", "all", sortByName, WS.C)).toEqual([]);
  });

  it("reads one item only inside its workspace", async () => {
    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ name: "Alpha brake pads", stockStatus: "low_stock" });
    expect(await getInventoryItem("item-c1", WS.A)).toBeNull();
    expect(await getInventoryItem("item-c1", WS.C)).toBeNull();
  });

  it("updates an item and refuses items from other workspaces", async () => {
    const updated = await updateInventoryItem({ ...form, id: "item-a1", name: "Pads v2", sku: "AP-1", quantity: 20 }, WS.A);
    expect(updated).toMatchObject({ name: "Pads v2", stockStatus: "in_stock" });
    expect(fake.requests.find((item) => item.op === "update")?.values).not.toHaveProperty("workspace_id");

    await expect(updateInventoryItem({ ...form, id: "item-c1" }, WS.A)).rejects.toThrow("Inventory item was not found or you do not have permission to change it.");
    expect(row("inventory_items", "item-c1")?.name).toBe("Gamma oil");
  });

  it("recomputes stockStatus when quantity crosses each threshold", async () => {
    const base = { ...form, id: "item-a1", name: "Alpha brake pads", sku: "AP-1", minQuantity: 5 };

    expect(await updateInventoryItem({ ...base, quantity: 5 }, WS.A)).toMatchObject({ quantity: 5, stockStatus: "low_stock" });
    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ stockStatus: "low_stock" });

    expect(await updateInventoryItem({ ...base, quantity: 6 }, WS.A)).toMatchObject({ quantity: 6, stockStatus: "in_stock" });
    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ stockStatus: "in_stock" });

    expect(await updateInventoryItem({ ...base, quantity: 0 }, WS.A)).toMatchObject({ quantity: 0, stockStatus: "out_of_stock" });
    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ stockStatus: "out_of_stock" });

    expect(await updateInventoryItem({ ...base, quantity: 1 }, WS.A)).toMatchObject({ quantity: 1, stockStatus: "low_stock" });
    expect((await getInventoryItems("", "low_stock", sortByName, WS.A)).map((item) => item.id)).toContain("item-a1");
  });

  it("issue and return RPCs change quantity and the view-derived stock status", async () => {
    fake.signInAs(USERS.owner.id);
    row("inventory_items", "item-a1")!.quantity = 6;
    row("inventory_items", "item-a1")!.min_quantity = 5;
    fake.all("order_materials").push({
      id: "om-a1",
      order_id: "order-a1",
      inventory_item_id: "item-a1",
      item_name: "Alpha brake pads",
      price: 12,
      quantity: 4,
      quantity_issued: 0,
      quantity_returned: 0,
      created_at: "2026-02-10T10:00:00.000Z",
    });

    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ quantity: 6, stockStatus: "in_stock" });

    await issueOrderMaterials("order-a1", [{ inventoryItemId: "item-a1", quantity: 2 }], "issue-key-1");
    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ quantity: 4, stockStatus: "low_stock" });

    await issueOrderMaterials("order-a1", [{ inventoryItemId: "item-a1", quantity: 2 }], "issue-key-2");
    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ quantity: 2, stockStatus: "low_stock" });

    await returnOrderMaterials("order-a1", [{ inventoryItemId: "item-a1", quantity: 4 }], "unused", "return-key-1");
    expect(await getInventoryItem("item-a1", WS.A)).toMatchObject({ quantity: 6, stockStatus: "in_stock" });
  });

  it("deletes an item and refuses items from other workspaces", async () => {
    await deleteInventoryItem("item-a1", WS.A);
    expect(row("inventory_items", "item-a1")).toBeUndefined();
    await expect(deleteInventoryItem("item-c1", WS.C)).rejects.toThrow("Inventory item was not found or you do not have permission to delete it.");
    expect(row("inventory_items", "item-c1")).toBeDefined();
  });

  it("requires a workspace and hides raw database errors behind a retry message", async () => {
    await expect(getInventoryItems("", "all", sortByName, undefined)).rejects.toThrow("No active workspace selected");
    fake.failNext("inventory_items_with_status", "select", { code: "PGRST000", message: "internal detail" });
    await expect(getInventoryItems("", "all", sortByName, WS.A)).rejects.toThrow("Could not load inventory. Please try again.");
    fake.failNext("inventory_items", "delete", { code: "XX000", message: "internal detail" });
    await expect(deleteInventoryItem("item-a1", WS.A)).rejects.toThrow("Could not delete the inventory item. Please try again.");
  });
});

describe("inventory markup", () => {
  it("reads the workspace markup for any member", async () => {
    expect(await getInventoryMarkup(WS.A)).toBe(20);
    expect(await getInventoryMarkup(WS.C)).toBe(0);
  });

  it("lets only the owner change it", async () => {
    await expect(updateInventoryMarkup(WS.A, 35)).rejects.toThrow("Only the workspace owner can change the markup percentage.");
    fake.signInAs(USERS.admin.id);
    await expect(updateInventoryMarkup(WS.A, 35)).rejects.toThrow("Only the workspace owner can change the markup percentage.");
    expect(row("workspaces", WS.A)?.inventory_markup).toBe(20);

    fake.signInAs(USERS.owner.id);
    expect(await updateInventoryMarkup(WS.A, 35)).toBe(35);
    expect(row("workspaces", WS.A)?.inventory_markup).toBe(35);
  });

  it("validates the value before calling Supabase", async () => {
    fake.signInAs(USERS.owner.id);
    await expect(updateInventoryMarkup(WS.A, -1)).rejects.toThrow("Markup percentage cannot be negative");
    await expect(updateInventoryMarkup(WS.A, 1001)).rejects.toThrow("Markup percentage cannot be greater than 1000");
    await expect(updateInventoryMarkup(WS.A, Number.NaN)).rejects.toThrow("Markup percentage must be a number");
    expect(fake.requests.filter((item) => item.op === "update")).toHaveLength(0);
  });
});
