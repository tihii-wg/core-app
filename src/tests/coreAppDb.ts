// Core App security model for the fake Supabase client.
// workspace_members follows supabase/migrations/20260929000000_production_baseline.sql.
// The other tables follow the rules the app was hardened against (their policies are not in
// the repo): members read/write their workspace's data, services are managed by owner/admin,
// order_services is SELECT/INSERT/DELETE for members of the order's workspace (no UPDATE,
// supabase/migrations/20260929000500_order_services_member_delete.sql), workspaces cannot be deleted and only the owner may
// update them, owner_id is immutable, profiles are own-row only.
// invoices / invoice_items follow supabase/migrations/20261004010000_invoices.sql and
// 20261004020000_invoice_number_counters.sql and 20261004030000_protect_invoice_created_at.sql:
// member access per workspace, one invoice per order, created_at stamped by the database on insert,
// numbers unique per workspace and issued only by the database ('INV-PENDING-…' on insert, then
// 'INV-NEXT' -> the next number of the workspace's per-year counter, which never goes back), and
// invoice_items SELECT/INSERT only (rows go with the invoice). Counters live in
// invoice_number_counters, a table the client cannot reach.
// order_materials / sync_order_materials / issue-return follow
// 20261018170000_order_materials_stock.sql + 20261018180000_warehouse_issue_return.sql:
// members SELECT materials; sync writes requested lines only (no stock);
// issue/return RPCs (owner/admin/manager) change stock + ledger; order DELETE blocked if outstanding issued.
import { fake, permissionDenied, type PgError, type PolicyCtx, type Row } from "./fakeSupabase";

export const USERS = {
  owner: { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", name: "Olga Owner" },
  admin: { id: "22222222-2222-4222-8222-222222222222", email: "admin@example.com", name: "Adam Admin" },
  manager: { id: "33333333-3333-4333-8333-333333333333", email: "manager@example.com", name: "Mia Manager" },
  member: { id: "44444444-4444-4444-8444-444444444444", email: "member@example.com", name: "Max Member" },
  outsider: { id: "55555555-5555-4555-8555-555555555555", email: "outsider@example.com", name: "Otto Outsider" },
  newbie: { id: "66666666-6666-4666-8666-666666666666", email: "newbie@example.com", name: "Nina Newbie" },
} as const;

export const WS = {
  A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  C: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

export const INDUSTRY_ID = "99999999-9999-4999-8999-999999999999";
export const PASSWORD = "password123";

const roleRank: Record<string, number> = { owner: 0, admin: 1, manager: 2, member: 3 };

const deviceClock = () => new Date().toISOString();
let databaseNow = deviceClock;

/** Sets the database's now() (stamped on new invoices) apart from the device clock; null follows the device again. */
export function setDatabaseClock(instant: string | null) {
  databaseNow = instant ? () => instant : deviceClock;
}

function yearOf(timestamp: unknown, timeZone: string) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(new Date(String(timestamp))));
}

/** Mirrors public.protect_invoice_identity issuing 'INV-NEXT'. */
function issueInvoiceNumber(invoice: Row, ctx: PolicyCtx) {
  const zone = String(ctx.fake.all("workspaces").find((row) => row.id === invoice.workspace_id)?.timezone ?? "").trim() || "Europe/Chisinau";
  let year: number;
  try {
    year = yearOf(invoice.created_at, zone);
  } catch {
    year = yearOf(invoice.created_at, "Europe/Chisinau");
  }
  const counters = ctx.fake.all("invoice_number_counters");
  let counter = counters.find((row) => row.workspace_id === invoice.workspace_id && row.year === year);
  if (!counter) {
    counter = { workspace_id: invoice.workspace_id, year, last_number: 0 };
    counters.push(counter);
  }
  for (;;) {
    counter.last_number = Number(counter.last_number) + 1;
    const number = `INV-${year}-${String(counter.last_number).padStart(3, "0")}`;
    if (!ctx.fake.all("invoices").some((row) => row.workspace_id === invoice.workspace_id && row.number === number)) return number;
  }
}

/** Mirrors public.workspace_member_role(uuid): the caller's role in an active workspace, or null. */
export function roleIn(workspaceId: unknown, ctx: PolicyCtx) {
  if (!ctx.uid) return null;
  const workspace = ctx.fake.all("workspaces").find((row) => row.id === workspaceId);
  if (!workspace || workspace.deleted_at) return null;
  const roles = ctx.fake
    .all("workspace_members")
    .filter((row) => row.workspace_id === workspaceId && row.user_id === ctx.uid && !row.deleted_at)
    .map((row) => String(row.role))
    .sort((a, b) => (roleRank[a] ?? 9) - (roleRank[b] ?? 9));
  return roles[0] ?? null;
}

const isMember = (workspaceId: unknown, ctx: PolicyCtx) => roleIn(workspaceId, ctx) != null;
const canManageServices = (workspaceId: unknown, ctx: PolicyCtx) => ["owner", "admin"].includes(roleIn(workspaceId, ctx) ?? "");

function canManageRole(workspaceId: unknown, targetRole: unknown, ctx: PolicyCtx) {
  const role = roleIn(workspaceId, ctx);
  if (role === "owner") return ["admin", "manager", "member"].includes(String(targetRole));
  if (role === "admin") return ["manager", "member"].includes(String(targetRole));
  return false;
}

function canBootstrap(workspaceId: unknown, ctx: PolicyCtx) {
  const workspace = ctx.fake.all("workspaces").find((row) => row.id === workspaceId);
  return Boolean(workspace && workspace.owner_id === ctx.uid && !workspace.deleted_at) && !ctx.fake.all("workspace_members").some((row) => row.workspace_id === workspaceId);
}

const memberTable = {
  select: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx),
  insert: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx),
  update: { using: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx) },
  delete: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx),
};

function error(message: string, code = "42501"): PgError {
  return { code, message };
}

function cloneRows(rows: Row[]) {
  return rows.map((row) => ({ ...row }));
}

function roundQty(value: number) {
  return Math.round(value * 100) / 100;
}

function canWarehouse(workspaceId: unknown, ctx: PolicyCtx) {
  return ["owner", "admin", "manager"].includes(roleIn(workspaceId, ctx) ?? "");
}

/** Mirrors sync_order_materials: requested lines only — never changes inventory quantity. */
function syncOrderMaterialsRpc(args: Record<string, unknown>, ctx: PolicyCtx): { data: Row[] | null; error: PgError | null } {
  const orderId = String(args.p_order_id ?? "");
  const payload = args.p_materials;
  if (!orderId) return { data: null, error: error("order_id is required", "22023") };
  if (!Array.isArray(payload)) return { data: null, error: error("materials must be a JSON array", "22023") };

  const order = ctx.fake.all("orders").find((row) => row.id === orderId);
  if (!order || !isMember(order.workspace_id, ctx)) {
    return { data: null, error: error("Order was not found or you do not have permission to change it.") };
  }

  const desired = new Map<string, number>();
  for (const raw of payload) {
    const elem = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const itemId = elem ? String(elem.inventory_item_id ?? "") : "";
    const quantity = elem ? roundQty(Number(elem.quantity)) : NaN;
    if (!itemId) return { data: null, error: error("inventory_item_id is required", "22023") };
    if (!Number.isFinite(quantity) || quantity <= 0) return { data: null, error: error("Material quantity must be greater than 0", "22023") };
    desired.set(itemId, roundQty((desired.get(itemId) ?? 0) + quantity));
  }

  const materialsSnapshot = cloneRows(ctx.fake.all("order_materials"));
  const orderSnapshot = { ...order };
  const rollback = () => {
    ctx.fake.tables.order_materials = materialsSnapshot;
    Object.assign(order, orderSnapshot);
  };
  const fail = (message: string, code = "P0001") => {
    rollback();
    return { data: null, error: error(message, code) };
  };

  for (const itemId of desired.keys()) {
    if (!ctx.fake.all("inventory_items").some((row) => row.id === itemId && row.workspace_id === order.workspace_id)) {
      return fail("Inventory item is unavailable in this workspace");
    }
  }

  for (const row of ctx.fake.all("order_materials").filter((line) => line.order_id === orderId)) {
    const itemId = String(row.inventory_item_id);
    const issued = Number(row.quantity_issued ?? 0);
    const returned = Number(row.quantity_returned ?? 0);
    const outstanding = issued - returned;
    const nextQty = desired.get(itemId) ?? 0;
    if (nextQty === 0 && outstanding > 0) return fail("Cannot remove a material with outstanding issued quantity");
    if (nextQty > 0 && nextQty < issued) return fail("Requested quantity cannot be less than already issued quantity");
  }

  ctx.fake.tables.order_materials = ctx.fake
    .all("order_materials")
    .filter((row) => row.order_id !== orderId || desired.has(String(row.inventory_item_id)) || Number(row.quantity_issued ?? 0) > 0);

  for (const [itemId, quantity] of [...desired.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = ctx.fake.all("order_materials").find((row) => row.order_id === orderId && row.inventory_item_id === itemId);
    if (existing) {
      existing.quantity = quantity;
      continue;
    }
    const catalog = ctx.fake.all("inventory_items").find((row) => row.id === itemId)!;
    ctx.fake.all("order_materials").push({
      id: crypto.randomUUID(),
      order_id: orderId,
      inventory_item_id: itemId,
      item_name: String(catalog.name),
      price: Number(catalog.selling_price ?? 0),
      quantity,
      quantity_issued: 0,
      quantity_returned: 0,
      created_at: new Date().toISOString(),
    });
  }

  // Drop zero-issue lines that are no longer desired.
  ctx.fake.tables.order_materials = ctx.fake
    .all("order_materials")
    .filter((row) => row.order_id !== orderId || desired.has(String(row.inventory_item_id)) || Number(row.quantity_issued ?? 0) > 0);

  const serviceTotal = ctx.fake
    .all("order_services")
    .filter((row) => row.order_id === orderId)
    .reduce((total, line) => total + Number(line.price ?? 0) * Number(line.quantity ?? 1), 0);
  const materialTotal = ctx.fake
    .all("order_materials")
    .filter((row) => row.order_id === orderId)
    .reduce((total, line) => total + Number(line.price ?? 0) * Number(line.quantity ?? 1), 0);
  order.total_price = serviceTotal + materialTotal;
  order.updated_at = new Date().toISOString();

  return {
    data: ctx.fake
      .all("order_materials")
      .filter((row) => row.order_id === orderId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))),
    error: null,
  };
}

function parsePositiveIntQty(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isInteger(n)) return null;
  if (n > 2147483647) return null;
  return n;
}

function normalizeWarehouseLines(
  kind: "issue" | "return",
  payload: unknown[],
): { lines: Array<{ inventoryItemId: string; quantity: number }> } | { error: PgError } {
  const seen = new Set<string>();
  const lines: Array<{ inventoryItemId: string; quantity: number }> = [];
  for (const raw of payload) {
    const elem = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const itemId = elem ? String(elem.inventory_item_id ?? "").trim() : "";
    const quantity = elem ? parsePositiveIntQty(elem.quantity) : null;
    if (!itemId || quantity == null) {
      return { error: error(`Each ${kind} line requires inventory_item_id and quantity > 0`, "22023") };
    }
    if (seen.has(itemId)) {
      return { error: error(`Duplicate inventory_item_id in ${kind} lines`, "22023") };
    }
    seen.add(itemId);
    lines.push({ inventoryItemId: itemId, quantity });
  }
  lines.sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId));
  return { lines };
}

function warehouseLinesFingerprint(lines: Array<{ inventoryItemId: string; quantity: number }>) {
  return lines.map((line) => `${line.inventoryItemId}:${line.quantity}`).join("|");
}

function issueOrReturnRpc(
  kind: "issue" | "return",
  args: Record<string, unknown>,
  ctx: PolicyCtx,
): { data: Row[] | null; error: PgError | null } {
  const orderId = String(args.p_order_id ?? "");
  const payload = args.p_lines;
  const idempotencyKey = typeof args.p_idempotency_key === "string" ? args.p_idempotency_key.trim() : "";
  const reasonRaw = typeof args.p_reason === "string" ? args.p_reason.trim() : "";
  const reason = kind === "return" ? reasonRaw || null : null;

  if (!orderId) return { data: null, error: error("order_id is required", "22023") };
  if (!Array.isArray(payload) || payload.length === 0) return { data: null, error: error(`${kind} lines must be a non-empty JSON array`, "22023") };
  if (kind === "return" && reason && reason.length > 500) {
    return { data: null, error: error("Return reason is too long", "22023") };
  }

  const parsed = normalizeWarehouseLines(kind, payload);
  if ("error" in parsed) return { data: null, error: parsed.error };
  const { lines } = parsed;
  const requestFingerprint = warehouseLinesFingerprint(lines);

  const order = ctx.fake.all("orders").find((row) => row.id === orderId);
  if (!order || !isMember(order.workspace_id, ctx)) {
    return { data: null, error: error("Order was not found or you do not have permission to change it.") };
  }
  if (!canWarehouse(order.workspace_id, ctx)) {
    return { data: null, error: error(`You do not have permission to ${kind} warehouse materials.`) };
  }

  if (idempotencyKey) {
    const existingAll = ctx.fake
      .all("inventory_movements")
      .filter((row) => row.workspace_id === order.workspace_id && row.idempotency_key === idempotencyKey);
    if (existingAll.length > 0) {
      const mismatch = existingAll.some(
        (row) =>
          row.movement_type !== kind ||
          row.order_id !== orderId ||
          (kind === "return" && (row.reason ?? null) !== reason),
      );
      const existingLines = existingAll
        .map((row) => ({ inventoryItemId: String(row.inventory_item_id), quantity: Number(row.quantity) }))
        .sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId));
      if (mismatch || warehouseLinesFingerprint(existingLines) !== requestFingerprint) {
        return { data: null, error: error("Idempotency key was already used with a different warehouse operation", "22023") };
      }
      return {
        data: existingAll
          .filter((row) => row.movement_type === kind && row.order_id === orderId)
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))),
        error: null,
      };
    }
  }

  const inventorySnapshot = cloneRows(ctx.fake.all("inventory_items"));
  const materialsSnapshot = cloneRows(ctx.fake.all("order_materials"));
  const movementsSnapshot = cloneRows(ctx.fake.all("inventory_movements"));
  const rollback = () => {
    ctx.fake.tables.inventory_items = inventorySnapshot;
    ctx.fake.tables.order_materials = materialsSnapshot;
    ctx.fake.tables.inventory_movements = movementsSnapshot;
  };
  const fail = (message: string, code = "P0001") => {
    rollback();
    return { data: null, error: error(message, code) };
  };

  const created: Row[] = [];
  for (const { inventoryItemId: itemId, quantity } of lines) {
    const line = ctx.fake.all("order_materials").find((row) => row.order_id === orderId && row.inventory_item_id === itemId);
    if (!line) return fail("Material is not on this order");
    const item = ctx.fake.all("inventory_items").find((row) => row.id === itemId && row.workspace_id === order.workspace_id);
    if (!item) return fail("Inventory item is unavailable in this workspace");

    const issued = Number(line.quantity_issued ?? 0);
    const returned = Number(line.quantity_returned ?? 0);
    if (kind === "issue") {
      const remaining = Number(line.quantity) - issued;
      if (quantity > remaining) return fail("Cannot issue more than the remaining requested quantity");
      if (Number(item.quantity) < quantity) return fail("insufficient_stock");
      item.quantity = roundQty(Number(item.quantity) - quantity);
      line.quantity_issued = issued + quantity;
    } else {
      const remaining = issued - returned;
      if (quantity > remaining) return fail("Cannot return more than the outstanding issued quantity");
      item.quantity = roundQty(Number(item.quantity) + quantity);
      line.quantity_returned = returned + quantity;
    }
    item.updated_at = new Date().toISOString();

    const movement = {
      id: crypto.randomUUID(),
      workspace_id: order.workspace_id,
      inventory_item_id: itemId,
      order_id: orderId,
      order_material_id: line.id,
      movement_type: kind,
      quantity,
      reason,
      idempotency_key: idempotencyKey || null,
      created_by: ctx.uid,
      created_at: new Date().toISOString(),
    };

    const uniqueError = ctx.fake.uniqueViolation("inventory_movements", [movement]);
    if (uniqueError) return fail(uniqueError.message, uniqueError.code ?? "23505");

    ctx.fake.all("inventory_movements").push(movement);
    created.push(movement);
  }

  return { data: created, error: null };
}

export function installSecurityModel() {
  fake.relations = {
    orders: { clients: { table: "clients", column: "client_id" } },
    invoices: { clients: { table: "clients", column: "client_id" } },
    workspace_members: { workspaces: { table: "workspaces", column: "workspace_id" } },
    workspaces: { industries: { table: "industries", column: "industry_id" } },
  };
  fake.views = {
    inventory_items_with_status: {
      base: "inventory_items",
      map: (row) => {
        const quantity = Number(row.quantity ?? 0);
        const min = Number(row.min_quantity ?? 0);
        return { ...row, stock_status: quantity <= 0 ? "out_of_stock" : quantity <= min ? "low_stock" : "in_stock" };
      },
    },
  };
  fake.defaults = {
    workspaces: (row) => ({ deleted_at: null, inventory_markup: 0, avatar_path: null, timezone: "Europe/Chisinau", currency: "MDL", ...row }),
    workspace_members: (row) => ({ deleted_at: null, ...row }),
    clients: (row) => ({ balance: 0, ...row }),
    services: (row) => ({ category: null, ...row }),
    orders: (row) => ({ updated_at: row.created_at, ...row }),
    inventory_items: (row) => ({
      // Mirrors DB default after migration 20261018220000 (existing seed rows still set min_quantity).
      min_quantity: 10,
      updated_at: row.created_at,
      ...row,
    }),
    invoices: (row) => ({ status: "draft", due_date: null, paid_at: null, updated_at: row.created_at, ...row }),
  };
  fake.uniques = {
    inventory_items: [["workspace_id", "sku"]],
    invoices: [["workspace_id", "number"], ["order_id"]],
    order_materials: [["order_id", "inventory_item_id"]],
    inventory_movements: [["workspace_id", "idempotency_key", "inventory_item_id"]],
  };

  fake.policies = {
    industries: { select: (row) => row.is_active !== false },
    profiles: {
      select: (row, ctx) => row.id === ctx.uid,
      insert: (row, ctx) => row.id === ctx.uid,
      update: { using: (row, ctx) => row.id === ctx.uid },
    },
    workspaces: {
      select: (row, ctx) => isMember(row.id, ctx) || (row.owner_id === ctx.uid && !row.deleted_at),
      insert: (row, ctx) => row.owner_id === ctx.uid,
      update: { using: (row, ctx) => roleIn(row.id, ctx) === "owner" },
    },
    workspace_members: {
      select: (row, ctx) =>
        (!row.deleted_at && (row.user_id === ctx.uid || isMember(row.workspace_id, ctx))) || (Boolean(row.deleted_at) && row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx)),
      insert: (row, ctx) =>
        !row.deleted_at && ((row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx)) || (row.user_id === ctx.uid && row.role === "owner" && canBootstrap(row.workspace_id, ctx))),
      update: {
        using: (row, ctx) => row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx),
        check: (row, ctx) => row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx),
      },
    },
    services: {
      select: (row, ctx) => isMember(row.workspace_id, ctx),
      insert: (row, ctx) => canManageServices(row.workspace_id, ctx),
      update: { using: (row, ctx) => canManageServices(row.workspace_id, ctx) },
      delete: (row, ctx) => canManageServices(row.workspace_id, ctx),
    },
    clients: memberTable,
    employees: memberTable,
    orders: memberTable,
    inventory_items: memberTable,
    order_services: {
      select: (row, ctx) => isMember(ctx.fake.all("orders").find((order) => order.id === row.order_id)?.workspace_id, ctx),
      insert: (row, ctx) => isMember(ctx.fake.all("orders").find((order) => order.id === row.order_id)?.workspace_id, ctx),
      delete: (row, ctx) => isMember(ctx.fake.all("orders").find((order) => order.id === row.order_id)?.workspace_id, ctx),
    },
    order_materials: {
      select: (row, ctx) => isMember(ctx.fake.all("orders").find((order) => order.id === row.order_id)?.workspace_id, ctx),
    },
    inventory_movements: {
      select: (row, ctx) => isMember(row.workspace_id, ctx),
    },
    invoices: memberTable,
    invoice_items: {
      select: (row, ctx) => isMember(ctx.fake.all("invoices").find((invoice) => invoice.id === row.invoice_id)?.workspace_id, ctx),
      insert: (row, ctx) => isMember(ctx.fake.all("invoices").find((invoice) => invoice.id === row.invoice_id)?.workspace_id, ctx),
    },
  };

  fake.grants = {
    industries: { insert: false, update: false, delete: false },
    workspaces: { delete: false },
    profiles: { delete: false },
    workspace_members: { insert: ["workspace_id", "user_id", "role"], update: ["role", "deleted_at"], delete: false },
    order_services: { update: false },
    order_materials: { insert: false, update: false, delete: false },
    inventory_movements: { insert: false, update: false, delete: false },
    invoice_items: { update: false, delete: false },
    invoice_number_counters: { select: false, insert: false, update: false, delete: false },
  };

  fake.triggers = {
    workspaces: (op, oldRow, newRow) => {
      if (op === "UPDATE" && oldRow && newRow && newRow.owner_id !== oldRow.owner_id) return error("owner_id cannot be changed");
      return null;
    },
    orders: (op, oldRow, _newRow, ctx) => {
      if (op === "DELETE" && oldRow) {
        const outstanding = ctx.fake
          .all("order_materials")
          .some((row) => row.order_id === oldRow.id && Number(row.quantity_issued ?? 0) - Number(row.quantity_returned ?? 0) > 0);
        if (outstanding) return error("Cannot delete an order with outstanding issued materials. Return issued stock first.", "P0001");
        ctx.fake.tables.order_materials = ctx.fake.all("order_materials").filter((row) => row.order_id !== oldRow.id);
        ctx.fake.tables.order_services = ctx.fake.all("order_services").filter((row) => row.order_id !== oldRow.id);
      }
      return null;
    },
    workspace_members: (op, oldRow, newRow, ctx) => {
      if (op === "INSERT" && newRow) {
        if (newRow.role === "owner" && !(newRow.user_id === ctx.uid && canBootstrap(newRow.workspace_id, ctx))) return error("Owner memberships cannot be created through team management");
        return null;
      }
      if (op === "UPDATE" && oldRow && newRow) {
        if (newRow.workspace_id !== oldRow.workspace_id || newRow.user_id !== oldRow.user_id) return error("workspace_id and user_id cannot be changed");
        if (oldRow.role === "owner" || newRow.role === "owner") return error("The workspace owner cannot be changed through team management");
        return null;
      }
      if (oldRow?.role === "owner") return error("The workspace owner cannot be removed through team management");
      return null;
    },
    invoices: (op, oldRow, newRow, ctx) => {
      if (op === "INSERT" && newRow) {
        if (!String(newRow.number).startsWith("INV-PENDING-")) return error("Invoice numbers are assigned by the database");
        newRow.created_at = databaseNow();
        return null;
      }
      if (op === "DELETE") {
        ctx.fake.tables.invoice_items = ctx.fake.all("invoice_items").filter((item) => item.invoice_id !== oldRow?.id);
        return null;
      }
      if (!oldRow || !newRow) return null;
      if (newRow.workspace_id !== oldRow.workspace_id) return error("workspace_id cannot be changed");
      if (newRow.order_id !== oldRow.order_id) return error("order_id cannot be changed");
      if (newRow.created_at !== oldRow.created_at) return error("created_at cannot be changed");
      if (newRow.number !== oldRow.number) {
        if (!String(oldRow.number).startsWith("INV-PENDING-") || newRow.number !== "INV-NEXT") return error("An invoice number cannot be changed");
        newRow.number = issueInvoiceNumber(newRow, ctx);
      }
      return null;
    },
  };

  fake.rpcs = {
    workspace_member_profiles: ({ target_workspace }, ctx) => {
      if (!isMember(target_workspace, ctx)) return { data: [], error: null };
      const members = ctx.fake.all("workspace_members").filter((row) => row.workspace_id === target_workspace && !row.deleted_at);
      const profiles = members.flatMap((member) => ctx.fake.all("profiles").filter((profile) => profile.id === member.user_id));
      return { data: profiles.map((profile) => ({ user_id: profile.id, full_name: profile.full_name, email: profile.email })), error: null };
    },
    workspace_member_find_user: ({ target_workspace, member_email }, ctx) => {
      if (!["owner", "admin"].includes(roleIn(target_workspace, ctx) ?? "")) return { data: null, error: error("You do not have permission to add team members") };
      const email = String(member_email).trim().toLowerCase();
      return { data: ctx.fake.users.find((user) => user.email.toLowerCase() === email)?.id ?? null, error: null };
    },
    soft_delete_workspace: ({ target_workspace }, ctx) => {
      if (roleIn(target_workspace, ctx) !== "owner") return { data: null, error: error("Only the workspace owner can delete this workspace") };
      const now = new Date().toISOString();
      for (const row of ctx.fake.all("workspaces")) if (row.id === target_workspace && !row.deleted_at) row.deleted_at = now;
      for (const row of ctx.fake.all("workspace_members")) if (row.workspace_id === target_workspace && !row.deleted_at) row.deleted_at = now;
      return { data: null, error: null };
    },
    sync_order_materials: (args, ctx) => syncOrderMaterialsRpc(args, ctx),
    issue_order_materials: (args, ctx) => issueOrReturnRpc("issue", args, ctx),
    return_order_materials: (args, ctx) => issueOrReturnRpc("return", args, ctx),
  };

  fake.storagePolicy = (bucket, path, ctx) => bucket === "workspace" && isMember(path.split("/")[0], ctx);
}

export { permissionDenied };

type SeedWorkspace = { id: string; name: string; owner: string; members: [string, string][]; clients: string[]; services: [string, number, string?][]; employees: [string, string | null, string?][]; inventory: [string, string, number, number][] };

const seedWorkspaces: SeedWorkspace[] = [
  {
    id: WS.A,
    name: "Alpha Garage",
    owner: USERS.owner.id,
    members: [
      [USERS.admin.id, "admin"],
      [USERS.manager.id, "manager"],
      [USERS.member.id, "member"],
    ],
    clients: ["Ada Alpha"],
    services: [
      ["Oil change", 40],
      ["Brake check", 25, "inactive"],
    ],
    employees: [
      ["Tom Tech", USERS.member.id],
      ["Tina Tech", USERS.manager.id],
    ],
    inventory: [["Alpha brake pads", "AP-1", 2, 5]],
  },
  {
    id: WS.B,
    name: "Beta Service",
    owner: USERS.owner.id,
    members: [[USERS.admin.id, "member"]],
    clients: ["Bob Beta"],
    services: [["Beta wash", 15]],
    employees: [["Bert Beta", USERS.owner.id]],
    inventory: [["Beta filter", "BF-1", 10, 2]],
  },
  {
    id: WS.C,
    name: "Gamma Motors",
    owner: USERS.outsider.id,
    members: [],
    clients: ["Gus Gamma"],
    services: [["Gamma tune", 99]],
    employees: [["Greg Gamma", USERS.outsider.id]],
    inventory: [["Gamma oil", "GO-1", 0, 1]],
  },
];

const activeWorkspace: Record<string, string | null> = {
  [USERS.owner.id]: WS.A,
  [USERS.admin.id]: WS.A,
  [USERS.manager.id]: WS.A,
  [USERS.member.id]: WS.A,
  [USERS.outsider.id]: WS.C,
  [USERS.newbie.id]: null,
};

/** Resets the fake and loads three isolated workspaces (A, B owned by Olga; C by an outsider). */
export function seedCoreApp() {
  fake.reset();
  setDatabaseClock(null);
  installSecurityModel();

  fake.all("industries").push({ id: INDUSTRY_ID, name: "Auto Repair & Service", slug: "auto_repair", description: null, is_active: true, created_at: "2026-01-01T00:00:00.000Z" });

  for (const user of Object.values(USERS)) {
    fake.addUser({ id: user.id, email: user.email, password: PASSWORD });
    fake.all("profiles").push({ id: user.id, full_name: user.name, email: user.email, phone: null, active_workspace_id: activeWorkspace[user.id], theme: "light" });
  }

  const year = new Date().getFullYear();
  for (const workspace of seedWorkspaces) {
    const letter = workspace.id[0];
    fake.all("workspaces").push({
      id: workspace.id,
      name: workspace.name,
      owner_id: workspace.owner,
      industry_id: INDUSTRY_ID,
      deleted_at: null,
      avatar_path: null,
      inventory_markup: 20,
      language: "en",
      timezone: "Europe/Chisinau",
      date_format: "DD.MM.YYYY",
      currency: "MDL",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    fake.all("workspace_members").push({ workspace_id: workspace.id, user_id: workspace.owner, role: "owner", deleted_at: null, created_at: "2026-01-01T00:00:00.000Z" });
    workspace.members.forEach(([userId, role], index) => fake.all("workspace_members").push({ workspace_id: workspace.id, user_id: userId, role, deleted_at: null, created_at: `2026-01-0${index + 2}T00:00:00.000Z` }));

    workspace.clients.forEach((name, index) =>
      fake.all("clients").push({ id: `client-${letter}${index + 1}`, workspace_id: workspace.id, name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: "+37361111111", address: "", notes: "", client_type: "individual", tax_id: null, contact_person: null, balance: 0, created_at: "2026-02-01T10:00:00.000Z" }),
    );
    workspace.services.forEach(([name, price, status], index) =>
      fake.all("services").push({ id: `service-${letter}${index + 1}`, workspace_id: workspace.id, service_name: name, service_price: price, description: `${name} description`, status: status ?? "active", category: null }),
    );
    workspace.employees.forEach(([name, profileId, role], index) =>
      fake.all("employees").push({ id: `employee-${letter}${index + 1}`, workspace_id: workspace.id, name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: "+37362222222", role: role ?? "technician", status: "active", profile_id: profileId }),
    );
    workspace.inventory.forEach(([name, sku, quantity, min], index) =>
      fake.all("inventory_items").push({ id: `item-${letter}${index + 1}`, workspace_id: workspace.id, name, sku, description: null, category: "Parts", quantity, min_quantity: min, unit: "pcs", purchase_price: 10, selling_price: 12, supplier: null, location: null, is_active: true, created_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" }),
    );

    const service = fake.all("services").find((row) => row.workspace_id === workspace.id)!;
    const employee = fake.all("employees").find((row) => row.workspace_id === workspace.id)!;
    fake.all("orders").push({
      id: `order-${letter}1`,
      workspace_id: workspace.id,
      client_id: `client-${letter}1`,
      number: `ORD-${year}-001`,
      device: `${workspace.name} car`,
      car_number: `${letter.toUpperCase()}AA111`,
      description: "Noise",
      status: "new",
      assigned_to: null,
      employee_id: employee.id,
      deadline: `${year}-12-01T00:00:00.000Z`,
      total_price: service.service_price,
      is_paid: false,
      service: service.service_name,
      service_id: service.id,
      created_by: workspace.owner,
      created_at: `${year}-02-10T10:00:00.000Z`,
      updated_at: `${year}-02-10T10:00:00.000Z`,
    });
    fake.all("order_services").push({ id: `line-${letter}1`, order_id: `order-${letter}1`, service_id: service.id, service_name: service.service_name, price: service.service_price, quantity: 1, created_at: `${year}-02-10T10:00:00.000Z` });
  }
}

export function row(table: string, id: string) {
  return fake.all(table).find((item) => item.id === id);
}

export function membership(workspaceId: string, userId: string) {
  return fake.all("workspace_members").find((item) => item.workspace_id === workspaceId && item.user_id === userId);
}

/** Names of every row visible in the given table for the current session. */
export function namesIn(table: string, workspaceId: string, column = "name") {
  return fake
    .all(table)
    .filter((item) => item.workspace_id === workspaceId)
    .map((item) => String(item[column]));
}
