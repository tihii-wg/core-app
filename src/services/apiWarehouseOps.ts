import i18n from "../i18n";
import { lineAmount, sumLineAmounts, type OpLineInput, type WarehouseOpKind } from "../features/inventory/warehouseOps";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

export type OpLine = {
  id: string;
  inventoryItemId: string | null;
  itemName: string;
  quantity: number;
  unitCost: number;
  amount: number;
};

type OpBase = {
  id: string;
  workspaceId: string;
  number: string | null;
  comment: string;
  total: number;
  createdAt: string;
  posted: boolean;
  lines: OpLine[];
};

export type GoodsReceiptRecord = OpBase & {
  kind: "receipt";
  warehouseId: string | null;
  status: "draft" | "posted";
  receivedAt: string;
};

export type StockTransferRecord = OpBase & {
  kind: "transfer";
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  postedAt: string | null;
};

export type WriteOffRecord = OpBase & {
  kind: "writeOff";
  warehouseId: string | null;
  reason: string;
  postedAt: string | null;
};

export type WarehouseOpRecord = GoodsReceiptRecord | StockTransferRecord | WriteOffRecord;

export type WarehouseOpsResult<T> = {
  /** False when the operations tables are not applied yet (crm_ro_v1). */
  available: boolean;
  rows: T[];
};

type OpConfig = {
  doc: string;
  lines: string;
  fk: string;
  postRpc: string;
  postArg: string;
};

const configs: Record<WarehouseOpKind, OpConfig> = {
  receipt: { doc: "goods_receipts", lines: "goods_receipt_lines", fk: "goods_receipt_id", postRpc: "crm_post_goods_receipt", postArg: "p_receipt_id" },
  transfer: { doc: "stock_transfers", lines: "stock_transfer_lines", fk: "stock_transfer_id", postRpc: "crm_post_stock_transfer", postArg: "p_transfer_id" },
  writeOff: { doc: "write_offs", lines: "write_off_lines", fk: "write_off_id", postRpc: "crm_post_write_off", postArg: "p_write_off_id" },
};

const LIST_LIMIT = 100;

type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null };

const toNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const toText = (value: unknown) => (typeof value === "string" ? value : "");
const toId = (value: unknown) => (value ? String(value) : null);

/** The posting RPC does not exist on the connected database (PostgREST PGRST202 / Postgres 42883). */
export function isMissingRpcError(error: DbError | null | undefined) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|function .* does not exist/i.test(`${error.message ?? ""} ${error.details ?? ""}`);
}

function isPermissionError(error: DbError) {
  return error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "");
}

function unavailableError() {
  return new Error(i18n.t("inventory.ops.errors.unavailable"));
}

/** Strips the `crm_post_xxx: ` prefix that the RPCs put on their exception messages. */
export function cleanRpcMessage(message: string | undefined) {
  return (message ?? "").replace(/^crm_post_[a-z_]+:\s*/i, "").trim();
}

export function mapWarehouseOpsError(error: DbError, fallbackKey: "inventory.ops.errors.createFailed" | "inventory.ops.errors.postFailed") {
  if (isMissingRpcError(error)) return new Error(i18n.t("inventory.ops.errors.rpcMissing"));
  if (isMissingTableError(error)) return unavailableError();
  if (isPermissionError(error)) return new Error(i18n.t("inventory.ops.errors.permission"));
  if (error.code === "55000") return new Error(i18n.t("inventory.ops.errors.alreadyPosted"));
  if (error.code === "P0002") return new Error(i18n.t("inventory.ops.errors.notFound"));
  if (error.code === "23514") return new Error(i18n.t("inventory.ops.errors.insufficientStock", { detail: cleanRpcMessage(error.message) }));
  if (error.code === "22023") return new Error(i18n.t("inventory.ops.errors.invalid", { detail: cleanRpcMessage(error.message) }));
  return new Error(i18n.t(fallbackKey));
}

function toLine(row: Record<string, unknown>, names: Map<string, string>): OpLine {
  const inventoryItemId = toId(row.inventory_item_id);
  const storedName = toText(row.item_name);
  return {
    id: String(row.id),
    inventoryItemId,
    // Prefer the live inventory name; fall back to the name frozen on the line.
    itemName: (inventoryItemId ? names.get(inventoryItemId) : undefined) || storedName,
    quantity: toNum(row.quantity),
    unitCost: toNum(row.unit_cost),
    amount: toNum(row.amount),
  };
}

export function toWarehouseOp(
  kind: WarehouseOpKind,
  row: Record<string, unknown>,
  lines: OpLine[],
): WarehouseOpRecord {
  const base = {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    number: row.number ? String(row.number) : null,
    comment: toText(row.comment),
    total: toNum(row.total),
    createdAt: toText(row.created_at),
    lines,
  };
  if (kind === "receipt") {
    const status = row.status === "draft" ? "draft" : "posted";
    return {
      ...base,
      kind,
      warehouseId: toId(row.warehouse_id),
      status,
      posted: status === "posted",
      receivedAt: toText(row.received_at),
    };
  }
  const postedAt = toId(row.posted_at);
  if (kind === "transfer") {
    return { ...base, kind, fromWarehouseId: toId(row.from_warehouse_id), toWarehouseId: toId(row.to_warehouse_id), postedAt, posted: postedAt != null };
  }
  return { ...base, kind, warehouseId: toId(row.warehouse_id), reason: toText(row.reason), postedAt, posted: postedAt != null };
}

/** Item names for operation lines (best-effort second lookup, same approach as warehouse stock). */
async function getItemNames(workspaceId: string, itemIds: string[]) {
  const names = new Map<string, string>();
  if (itemIds.length === 0) return names;
  const { data, error } = await supabase.from("inventory_items").select("id, name").eq("workspace_id", workspaceId).in("id", itemIds);
  if (error) return names;
  for (const item of (data ?? []) as Record<string, unknown>[]) {
    if (typeof item.name === "string") names.set(String(item.id), item.name);
  }
  return names;
}

async function listOps<K extends WarehouseOpKind>(kind: K, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const config = configs[kind];

  // select("*"): `posted_at` only exists once the warehouse-ops SQL file is applied.
  const { data, error } = await supabase
    .from(config.doc)
    .select("*")
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    if (isMissingTableError(error, config.doc)) return { available: false, rows: [] as WarehouseOpRecord[] };
    throw new Error(error.message);
  }

  const docs = (data ?? []) as Record<string, unknown>[];
  const linesByDoc = new Map<string, Record<string, unknown>[]>();
  const itemIds = new Set<string>();

  if (docs.length > 0) {
    const { data: lineRows, error: linesError } = await supabase
      .from(config.lines)
      .select("*")
      .eq("workspace_id", resolved)
      .in(config.fk, docs.map((doc) => String(doc.id)))
      .order("position", { ascending: true });
    if (linesError) {
      if (isMissingTableError(linesError, config.lines)) return { available: false, rows: [] as WarehouseOpRecord[] };
      throw new Error(linesError.message);
    }
    for (const row of (lineRows ?? []) as Record<string, unknown>[]) {
      const key = String(row[config.fk]);
      linesByDoc.set(key, [...(linesByDoc.get(key) ?? []), row]);
      if (row.inventory_item_id) itemIds.add(String(row.inventory_item_id));
    }
  }

  const names = await getItemNames(resolved, [...itemIds]);
  const rows = docs.map((doc) =>
    toWarehouseOp(kind, doc, (linesByDoc.get(String(doc.id)) ?? []).map((line) => toLine(line, names))),
  );
  return { available: true, rows } as WarehouseOpsResult<WarehouseOpRecord>;
}

export async function getGoodsReceipts(workspaceId: string | undefined) {
  return (await listOps("receipt", workspaceId)) as WarehouseOpsResult<GoodsReceiptRecord>;
}

export async function getStockTransfers(workspaceId: string | undefined) {
  return (await listOps("transfer", workspaceId)) as WarehouseOpsResult<StockTransferRecord>;
}

export async function getWriteOffs(workspaceId: string | undefined) {
  return (await listOps("writeOff", workspaceId)) as WarehouseOpsResult<WriteOffRecord>;
}

export type CreateGoodsReceiptInput = { warehouseId: string; comment?: string; lines: OpLineInput[] };
export type CreateStockTransferInput = { fromWarehouseId: string; toWarehouseId: string; comment?: string; lines: OpLineInput[] };
export type CreateWriteOffInput = { warehouseId: string; reason?: string; comment?: string; lines: OpLineInput[] };

function lineRows(config: OpConfig, workspaceId: string, docId: string, lines: OpLineInput[]) {
  return lines.map((line, position) => ({
    workspace_id: workspaceId,
    [config.fk]: docId,
    inventory_item_id: line.inventoryItemId,
    item_name: line.itemName,
    quantity: line.quantity,
    unit_cost: line.unitCost,
    amount: lineAmount(line.quantity, line.unitCost),
    position,
  }));
}

/**
 * Inserts the draft document and its lines. Never touches stock or inventory_items.quantity:
 * only the `crm_post_*` RPCs do that.
 */
async function createOp(
  kind: WarehouseOpKind,
  workspaceId: string | undefined,
  header: Record<string, unknown>,
  lines: OpLineInput[],
) {
  const resolved = requireWorkspaceId(workspaceId);
  const config = configs[kind];
  if (lines.length === 0) throw new Error(i18n.t("inventory.ops.errors.noLines"));

  const { data, error } = await supabase
    .from(config.doc)
    .insert({ ...header, workspace_id: resolved, total: sumLineAmounts(lines) })
    .select("id")
    .single();
  if (error || !data) throw mapWarehouseOpsError(error ?? {}, "inventory.ops.errors.createFailed");

  const docId = String((data as Record<string, unknown>).id);
  const { error: linesError } = await supabase.from(config.lines).insert(lineRows(config, resolved, docId, lines));
  if (linesError) {
    // Best-effort cleanup so a failed save does not leave an empty draft behind.
    await supabase.from(config.doc).delete().eq("id", docId).eq("workspace_id", resolved);
    throw mapWarehouseOpsError(linesError, "inventory.ops.errors.createFailed");
  }
  return docId;
}

export function createGoodsReceipt(input: CreateGoodsReceiptInput, workspaceId: string | undefined) {
  return createOp(
    "receipt",
    workspaceId,
    // The column default is 'posted' (imports) — browser-created receipts are always drafts until posted via RPC.
    { warehouse_id: input.warehouseId, status: "draft", comment: input.comment?.trim() || null },
    input.lines,
  );
}

export function createStockTransfer(input: CreateStockTransferInput, workspaceId: string | undefined) {
  return createOp(
    "transfer",
    workspaceId,
    { from_warehouse_id: input.fromWarehouseId, to_warehouse_id: input.toWarehouseId, comment: input.comment?.trim() || null },
    input.lines,
  );
}

export function createWriteOff(input: CreateWriteOffInput, workspaceId: string | undefined) {
  return createOp(
    "writeOff",
    workspaceId,
    { warehouse_id: input.warehouseId, reason: input.reason?.trim() || null, comment: input.comment?.trim() || null },
    input.lines,
  );
}

async function postOp(kind: WarehouseOpKind, id: string) {
  const config = configs[kind];
  const { error } = await supabase.rpc(config.postRpc, { [config.postArg]: id });
  if (error) throw mapWarehouseOpsError(error, "inventory.ops.errors.postFailed");
}

/** Posts a draft receipt: warehouse_stock and inventory_items.quantity increase (server side only). */
export const postGoodsReceipt = (receiptId: string) => postOp("receipt", receiptId);

/**
 * Creates a draft goods receipt and immediately posts it via the same RPCs as the
 * standalone Warehouse → Operations flow. Stock changes only inside `crm_post_goods_receipt`.
 * Returns the receipt id. Does not invent client-side quantity updates.
 */
export async function createAndPostGoodsReceipt(input: CreateGoodsReceiptInput, workspaceId: string | undefined) {
  const receiptId = await createGoodsReceipt(input, workspaceId);
  try {
    await postGoodsReceipt(receiptId);
  } catch (error) {
    // Best-effort: leave the draft so the user can retry Post from Warehouse operations
    // instead of silently losing the receipt document after a post failure.
    throw error;
  }
  return receiptId;
}
/** Moves stock between warehouses; inventory_items.quantity is unchanged. */
export const postStockTransfer = (transferId: string) => postOp("transfer", transferId);
/** Decreases warehouse_stock and inventory_items.quantity. */
export const postWriteOff = (writeOffId: string) => postOp("writeOff", writeOffId);
