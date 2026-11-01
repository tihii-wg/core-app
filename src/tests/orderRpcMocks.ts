// Opt-in fakes for the manual-SQL RPCs that are NOT part of the default security model:
//   crm_set_order_line_discounts          (20261101070000_order_line_discounts_rpc.PRODUCTION.sql)
//   issue_order_materials_from_warehouse  (20261101080000_issue_order_materials_warehouse.PRODUCTION.sql)
//   return_order_materials_to_warehouse   (20261101100000_return_order_materials_warehouse.PRODUCTION.sql)
// Call the install function from a test AFTER seedCoreApp(); without it the fake answers PGRST202 ("function missing").
import { computeOrderMoney, isLineDiscountType, uniformPercentOf } from "../features/orders/orderTotals";
import { fake, type PgError, type PolicyCtx, type Row } from "./fakeSupabase";
import { roleIn } from "./coreAppDb";

type Result = { data: unknown; error: PgError | null };

const fail = (message: string, code = "P0001"): Result => ({ data: null, error: { code, message } });

function orderFor(args: Record<string, unknown>, ctx: PolicyCtx) {
  const order = ctx.fake.all("orders").find((row) => row.id === args.p_order_id);
  if (!order || roleIn(order.workspace_id, ctx) == null) return null;
  return order;
}

function discountOf(row: Row) {
  return { discountType: isLineDiscountType(row.discount_type) ? row.discount_type : null, discountValue: row.discount_value == null ? null : Number(row.discount_value) };
}

export function installOrderLineDiscountsRpc() {
  fake.rpcs.crm_set_order_line_discounts = (args, ctx) => {
    const order = orderFor(args, ctx);
    if (!order) return fail("Order was not found or you do not have permission to change it.", "42501");
    if (!["owner", "admin", "manager"].includes(roleIn(order.workspace_id, ctx) ?? "")) return fail("You do not have permission to edit order discounts.", "42501");
    const payload = args.p_lines;
    if (!Array.isArray(payload) || payload.length === 0) return fail("discount lines must be a non-empty JSON array", "22023");

    const services = ctx.fake.all("order_services").filter((row) => row.order_id === order.id);
    const materials = ctx.fake.all("order_materials").filter((row) => row.order_id === order.id);
    const writes: { row: Row; type: string | null; value: number | null }[] = [];

    for (const raw of payload as Record<string, unknown>[]) {
      const material = raw.order_material_id || raw.inventory_item_id;
      const service = raw.order_service_id || raw.service_id;
      if (Boolean(material) === Boolean(service)) return fail("Each discount line must reference exactly one material or one service", "22023");
      const pool = material ? materials : services;
      const matches = pool.filter((row) => (material ? (raw.order_material_id ? row.id === raw.order_material_id : row.inventory_item_id === raw.inventory_item_id) : raw.order_service_id ? row.id === raw.order_service_id : row.service_id === raw.service_id));
      if (matches.length === 0) return fail(material ? "Material is not on this order" : "Service is not on this order");
      if (matches.length > 1) return fail("More than one line matches; use the line id", "22023");
      const value = raw.discount_value == null || raw.discount_value === "" ? null : Number(raw.discount_value);
      const type = typeof raw.discount_type === "string" ? raw.discount_type : null;
      if (type === null || type === "none" || value === null || value === 0) {
        writes.push({ row: matches[0], type: null, value: null });
        continue;
      }
      if (!isLineDiscountType(type)) return fail("discount_type must be percent or amount", "22023");
      if (!Number.isFinite(value) || value < 0) return fail("discount_value cannot be negative", "22023");
      if (type === "percent" && value > 100) return fail("A percent discount cannot exceed 100", "22023");
      writes.push({ row: matches[0], type, value });
    }

    for (const write of writes) {
      write.row.discount_type = write.type;
      write.row.discount_value = write.value;
    }

    const toMoney = (row: Row) => ({ price: Number(row.price ?? 0), qty: Number(row.quantity ?? 0), ...discountOf(row) });
    const money = computeOrderMoney({ services: services.map(toMoney), materials: materials.map(toMoney) });
    order.total_price = money.total;
    order.discount_total = money.discountTotal;
    const uniform = uniformPercentOf([...services, ...materials].map(discountOf));
    order.discount_type = uniform === null ? null : "percent";
    order.discount_value = uniform;
    return { data: { order_id: order.id, lines_updated: writes.length, subtotal: money.subtotal, discount_total: money.discountTotal, total_price: money.total }, error: null };
  };
}

/** Seeds one warehouse (+ optional stock rows) for the workspace and returns its id. */
export function seedWarehouse(workspaceId: string, id: string, stock: Record<string, number> = {}, options: { isActive?: boolean; deletedAt?: string | null } = {}) {
  fake.all("warehouses").push({ id, workspace_id: workspaceId, name: `Warehouse ${id}`, warehouse_type: "company", is_default: false, is_active: options.isActive ?? true, deleted_at: options.deletedAt ?? null });
  for (const [itemId, quantity] of Object.entries(stock)) {
    fake.all("warehouse_stock").push({ id: `${id}:${itemId}`, workspace_id: workspaceId, warehouse_id: id, inventory_item_id: itemId, quantity });
  }
  return id;
}

export function installIssueFromWarehouseRpc() {
  fake.rpcs.issue_order_materials_from_warehouse = (args, ctx) => {
    const order = orderFor(args, ctx);
    if (!order) return fail("Order was not found or you do not have permission to change it.", "42501");
    if (!["owner", "admin", "manager"].includes(roleIn(order.workspace_id, ctx) ?? "")) return fail("You do not have permission to issue warehouse materials.", "42501");
    const warehouse = ctx.fake.all("warehouses").find((row) => row.id === args.p_warehouse_id);
    if (!warehouse || warehouse.workspace_id !== order.workspace_id || warehouse.deleted_at || warehouse.is_active === false) {
      return fail("Warehouse not found, inactive or in another workspace", "22023");
    }
    const payload = args.p_lines;
    if (!Array.isArray(payload) || payload.length === 0) return fail("issue lines must be a non-empty JSON array", "22023");
    const key = typeof args.p_idempotency_key === "string" ? args.p_idempotency_key.trim() : "";

    if (key) {
      const existing = ctx.fake.all("inventory_movements").filter((row) => row.workspace_id === order.workspace_id && row.idempotency_key === key);
      if (existing.length > 0) {
        const same =
          existing.every((row) => row.warehouse_id === warehouse.id && row.order_id === order.id && row.movement_type === "issue") &&
          existing.length === payload.length &&
          (payload as Record<string, unknown>[]).every((line) => existing.some((row) => row.inventory_item_id === line.inventory_item_id && Number(row.quantity) === Number(line.quantity)));
        if (!same) return fail("Idempotency key was already used with a different warehouse operation", "22023");
        return { data: existing, error: null };
      }
    }

    const snapshot = {
      inventory_items: ctx.fake.all("inventory_items").map((row) => ({ ...row })),
      order_materials: ctx.fake.all("order_materials").map((row) => ({ ...row })),
      warehouse_stock: ctx.fake.all("warehouse_stock").map((row) => ({ ...row })),
      inventory_movements: ctx.fake.all("inventory_movements").map((row) => ({ ...row })),
    };
    const rollback = (message: string): Result => {
      Object.assign(ctx.fake.tables, snapshot);
      return fail(message);
    };

    const created: Row[] = [];
    const seen = new Set<string>();
    for (const raw of payload as Record<string, unknown>[]) {
      const itemId = String(raw.inventory_item_id ?? "");
      const quantity = Number(raw.quantity);
      if (!itemId || !Number.isInteger(quantity) || quantity <= 0) return rollback("Each issue line requires inventory_item_id and quantity > 0");
      if (seen.has(itemId)) return rollback("Duplicate inventory_item_id in issue lines");
      seen.add(itemId);

      const line = ctx.fake.all("order_materials").find((row) => row.order_id === order.id && row.inventory_item_id === itemId);
      if (!line) return rollback("Material is not on this order");
      const item = ctx.fake.all("inventory_items").find((row) => row.id === itemId && row.workspace_id === order.workspace_id);
      if (!item) return rollback("Inventory item is unavailable in this workspace");
      if (Number(line.quantity) - Number(line.quantity_issued ?? 0) < quantity) return rollback("Cannot issue more than the remaining requested quantity");
      if (Number(item.quantity) < quantity) return rollback("insufficient_stock");
      const stock = ctx.fake.all("warehouse_stock").find((row) => row.warehouse_id === warehouse.id && row.inventory_item_id === itemId);
      if (!stock || Number(stock.quantity) < quantity) return rollback("insufficient_warehouse_stock");

      const batches = ctx.fake
        .all("stock_batches")
        .filter((row) => row.warehouse_id === warehouse.id && row.inventory_item_id === itemId && Number(row.quantity_left) > 0)
        .sort((a, b) => String(a.received_at ?? a.created_at ?? "").localeCompare(String(b.received_at ?? b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
      if (batches.length > 0) {
        const batchSum = batches.reduce((sum, row) => sum + Number(row.quantity_left), 0);
        if (batchSum < quantity) return rollback("insufficient_batch_stock");
        let left = quantity;
        for (const batch of batches) {
          if (left <= 0) break;
          const take = Math.min(Number(batch.quantity_left), left);
          batch.quantity_left = Number(batch.quantity_left) - take;
          left -= take;
        }
      }

      item.quantity = Number(item.quantity) - quantity;
      stock.quantity = Number(stock.quantity) - quantity;
      line.quantity_issued = Number(line.quantity_issued ?? 0) + quantity;
      const movement = {
        id: crypto.randomUUID(),
        workspace_id: order.workspace_id,
        inventory_item_id: itemId,
        order_id: order.id,
        order_material_id: line.id,
        warehouse_id: warehouse.id,
        movement_type: "issue",
        quantity,
        reason: null,
        idempotency_key: key || null,
        created_by: ctx.uid,
        created_at: new Date().toISOString(),
      };
      ctx.fake.all("inventory_movements").push(movement);
      created.push(movement);
    }
    return { data: created, error: null };
  };
}

export function installReturnToWarehouseRpc() {
  fake.rpcs.return_order_materials_to_warehouse = (args, ctx) => {
    const order = orderFor(args, ctx);
    if (!order) return fail("Order was not found or you do not have permission to change it.", "42501");
    if (!["owner", "admin", "manager"].includes(roleIn(order.workspace_id, ctx) ?? "")) {
      return fail("You do not have permission to return warehouse materials.", "42501");
    }
    const warehouse = ctx.fake.all("warehouses").find((row) => row.id === args.p_warehouse_id);
    if (!warehouse || warehouse.workspace_id !== order.workspace_id || warehouse.deleted_at || warehouse.is_active === false) {
      return fail("Warehouse not found, inactive or in another workspace", "22023");
    }
    const payload = args.p_lines;
    if (!Array.isArray(payload) || payload.length === 0) return fail("return lines must be a non-empty JSON array", "22023");
    const key = typeof args.p_idempotency_key === "string" ? args.p_idempotency_key.trim() : "";
    const reason = typeof args.p_reason === "string" && args.p_reason.trim() ? args.p_reason.trim() : null;

    if (key) {
      const existing = ctx.fake.all("inventory_movements").filter((row) => row.workspace_id === order.workspace_id && row.idempotency_key === key);
      if (existing.length > 0) {
        const same =
          existing.every(
            (row) =>
              row.warehouse_id === warehouse.id &&
              row.order_id === order.id &&
              row.movement_type === "return" &&
              (row.reason ?? null) === reason,
          ) &&
          existing.length === payload.length &&
          (payload as Record<string, unknown>[]).every((line) =>
            existing.some((row) => row.inventory_item_id === line.inventory_item_id && Number(row.quantity) === Number(line.quantity)),
          );
        if (!same) return fail("Idempotency key was already used with a different warehouse operation", "22023");
        return { data: existing, error: null };
      }
    }

    const snapshot = {
      inventory_items: ctx.fake.all("inventory_items").map((row) => ({ ...row })),
      order_materials: ctx.fake.all("order_materials").map((row) => ({ ...row })),
      warehouse_stock: ctx.fake.all("warehouse_stock").map((row) => ({ ...row })),
      inventory_movements: ctx.fake.all("inventory_movements").map((row) => ({ ...row })),
    };
    const rollback = (message: string): Result => {
      Object.assign(ctx.fake.tables, snapshot);
      return fail(message);
    };

    const created: Row[] = [];
    const seen = new Set<string>();
    for (const raw of payload as Record<string, unknown>[]) {
      const itemId = String(raw.inventory_item_id ?? "");
      const quantity = Number(raw.quantity);
      if (!itemId || !Number.isInteger(quantity) || quantity <= 0) return rollback("Each return line requires inventory_item_id and quantity > 0");
      if (seen.has(itemId)) return rollback("Duplicate inventory_item_id in return lines");
      seen.add(itemId);

      const line = ctx.fake.all("order_materials").find((row) => row.order_id === order.id && row.inventory_item_id === itemId);
      if (!line) return rollback("Material is not on this order");
      const item = ctx.fake.all("inventory_items").find((row) => row.id === itemId && row.workspace_id === order.workspace_id);
      if (!item) return rollback("Inventory item is unavailable in this workspace");
      const outstanding = Number(line.quantity_issued ?? 0) - Number(line.quantity_returned ?? 0);
      if (outstanding < quantity) return rollback("Cannot return more than the outstanding issued quantity");

      item.quantity = Number(item.quantity) + quantity;
      line.quantity_returned = Number(line.quantity_returned ?? 0) + quantity;
      let stock = ctx.fake.all("warehouse_stock").find((row) => row.warehouse_id === warehouse.id && row.inventory_item_id === itemId);
      if (!stock) {
        stock = {
          id: `${warehouse.id}:${itemId}`,
          workspace_id: order.workspace_id,
          warehouse_id: warehouse.id,
          inventory_item_id: itemId,
          quantity: 0,
        };
        ctx.fake.all("warehouse_stock").push(stock);
      }
      stock.quantity = Number(stock.quantity) + quantity;

      const movement = {
        id: crypto.randomUUID(),
        workspace_id: order.workspace_id,
        inventory_item_id: itemId,
        order_id: order.id,
        order_material_id: line.id,
        warehouse_id: warehouse.id,
        movement_type: "return",
        quantity,
        reason,
        idempotency_key: key || null,
        created_by: ctx.uid,
        created_at: new Date().toISOString(),
      };
      ctx.fake.all("inventory_movements").push(movement);
      created.push(movement);
    }
    return { data: created, error: null };
  };
}
