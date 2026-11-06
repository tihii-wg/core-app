import i18n from "../i18n";
import { lineAmount, sumLineAmounts, type OpLineInput, type WarehouseOpKind } from "../features/inventory/warehouseOps";
import { getInventoryItems } from "./apiInventory";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

export type OpLine = {
  id: string;
  inventoryItemId: string | null;
  itemName: string;
  /** Live catalog SKU when inventoryItemId is set; null otherwise. */
  itemSku: string | null;
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
  /** Free-text supplier (matches inventory_items.supplier). Null on legacy/mixed receipts. */
  supplierName: string | null;
};

/** Receipt listed on a supplier page; `matchedByLegacy` when supplier_name was null and match came from line items. */
export type SupplierDelivery = GoodsReceiptRecord & {
  matchedByLegacy: boolean;
};

export type SupplierDeliveriesPage = {
  rows: SupplierDelivery[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  /** Full merged list size (exact + legacy), not just the current page. */
  totalCount: number;
  /** Sum of `total` for posted receipts across the full merged list. */
  postedTotal: number;
  /** Max receivedAt/createdAt across the full merged list (ISO string), or null. */
  lastDeliveryAt: string | null;
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

export type SupplierReturnRecord = OpBase & {
  kind: "supplierReturn";
  warehouseId: string | null;
  goodsReceiptId: string | null;
  supplierName: string | null;
  reason: string;
  postedAt: string | null;
  /** Cash/bank account that received money back from the supplier (null until refunded). */
  refundAccountId: string | null;
  /** Linked finance_transactions income row (null until refunded). */
  financeTransactionId: string | null;
};

export type WarehouseOpRecord = GoodsReceiptRecord | StockTransferRecord | WriteOffRecord | SupplierReturnRecord;

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
  supplierReturn: {
    doc: "supplier_returns",
    lines: "supplier_return_lines",
    fk: "supplier_return_id",
    postRpc: "crm_post_supplier_return",
    postArg: "p_return_id",
  },
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
  if (isMissingRpcError(error)) {
    if (/crm_post_supplier_return/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
      return new Error(i18n.t("inventory.ops.errors.supplierReturnRpcMissing"));
    }
    return new Error(i18n.t("inventory.ops.errors.rpcMissing"));
  }
  if (isMissingTableError(error)) return unavailableError();
  if (isPermissionError(error)) return new Error(i18n.t("inventory.ops.errors.permission"));
  if (error.code === "55000") return new Error(i18n.t("inventory.ops.errors.alreadyPosted"));
  if (error.code === "P0002") return new Error(i18n.t("inventory.ops.errors.notFound"));
  if (error.code === "23514") return new Error(i18n.t("inventory.ops.errors.insufficientStock", { detail: cleanRpcMessage(error.message) }));
  if (error.code === "22023") return new Error(i18n.t("inventory.ops.errors.invalid", { detail: cleanRpcMessage(error.message) }));
  // RPCs often raise with "crm_post_*: human message" and no SQLSTATE — surface the cleaned text.
  if (/^crm_post_[a-z_]+:/i.test(error.message ?? "")) {
    const cleaned = cleanRpcMessage(error.message);
    if (cleaned) return new Error(cleaned);
  }
  return new Error(i18n.t(fallbackKey));
}

type ItemLookup = { name: string; sku: string | null };

function toLine(row: Record<string, unknown>, catalog: Map<string, ItemLookup>): OpLine {
  const inventoryItemId = toId(row.inventory_item_id);
  const storedName = toText(row.item_name);
  const lookup = inventoryItemId ? catalog.get(inventoryItemId) : undefined;
  return {
    id: String(row.id),
    inventoryItemId,
    // Prefer the live inventory name; fall back to the name frozen on the line.
    itemName: lookup?.name || storedName,
    itemSku: lookup?.sku ?? null,
    quantity: toNum(row.quantity),
    unitCost: toNum(row.unit_cost),
    amount: toNum(row.amount),
  };
}

function normalizeOptionalSupplierName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
      supplierName: normalizeOptionalSupplierName(row.supplier_name),
    };
  }
  const postedAt = toId(row.posted_at);
  if (kind === "transfer") {
    return { ...base, kind, fromWarehouseId: toId(row.from_warehouse_id), toWarehouseId: toId(row.to_warehouse_id), postedAt, posted: postedAt != null };
  }
  if (kind === "supplierReturn") {
    return {
      ...base,
      kind,
      warehouseId: toId(row.warehouse_id),
      goodsReceiptId: toId(row.goods_receipt_id),
      supplierName: normalizeOptionalSupplierName(row.supplier_name),
      reason: toText(row.reason),
      postedAt,
      posted: postedAt != null,
      refundAccountId: toId(row.refund_account_id),
      financeTransactionId: toId(row.finance_transaction_id),
    };
  }
  return { ...base, kind, warehouseId: toId(row.warehouse_id), reason: toText(row.reason), postedAt, posted: postedAt != null };
}

/** Item name + SKU for operation lines (best-effort second lookup, same approach as warehouse stock). */
async function getItemNames(workspaceId: string, itemIds: string[]) {
  const catalog = new Map<string, ItemLookup>();
  if (itemIds.length === 0) return catalog;
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, name, sku")
    .eq("workspace_id", workspaceId)
    .in("id", itemIds);
  if (error) return catalog;
  for (const item of (data ?? []) as Record<string, unknown>[]) {
    const id = String(item.id);
    const name = typeof item.name === "string" ? item.name : "";
    const skuRaw = typeof item.sku === "string" ? item.sku.trim() : "";
    catalog.set(id, { name, sku: skuRaw || null });
  }
  return catalog;
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

export type CreateGoodsReceiptInput = {
  warehouseId: string;
  comment?: string;
  /** Free-text supplier; trimmed, empty → null. Written to goods_receipts.supplier_name. */
  supplierName?: string | null;
  lines: OpLineInput[];
};
export type CreateStockTransferInput = { fromWarehouseId: string; toWarehouseId: string; comment?: string; lines: OpLineInput[] };
export type CreateWriteOffInput = { warehouseId: string; reason?: string; comment?: string; lines: OpLineInput[] };

function isMissingSupplierNameColumn(error: DbError | null | undefined) {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") {
    return /supplier_name/i.test(`${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`);
  }
  return /supplier_name/i.test(error.message ?? "") && /schema cache|does not exist|column/i.test(error.message ?? "");
}

function normalizeSupplierName(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

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

  let insertHeader = { ...header, workspace_id: resolved, total: sumLineAmounts(lines) };
  let { data, error } = await supabase.from(config.doc).insert(insertHeader).select("id").single();

  // goods_receipts.supplier_name is optional until the SQL is applied — retry without it.
  if (error && kind === "receipt" && isMissingSupplierNameColumn(error) && "supplier_name" in insertHeader) {
    const { supplier_name: _unused, ...withoutSupplier } = insertHeader;
    void _unused;
    insertHeader = withoutSupplier;
    ({ data, error } = await supabase.from(config.doc).insert(insertHeader).select("id").single());
  }

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
  const supplierName = normalizeSupplierName(input.supplierName);
  return createOp(
    "receipt",
    workspaceId,
    // The column default is 'posted' (imports) — browser-created receipts are always drafts until posted via RPC.
    {
      warehouse_id: input.warehouseId,
      status: "draft",
      comment: input.comment?.trim() || null,
      supplier_name: supplierName,
    },
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

export type SupplierReturnRefundInput = {
  accountId: string;
  /** When omitted/null, the combined post RPC uses the posted return total. */
  amount?: number | null;
  comment?: string | null;
};

export type CreateSupplierReturnInput = {
  warehouseId: string;
  goodsReceiptId?: string | null;
  supplierName?: string | null;
  reason?: string;
  comment?: string;
  lines: OpLineInput[];
  /** When set, posts via crm_post_supplier_return_with_refund. */
  refund?: SupplierReturnRefundInput | null;
};

export type CreateAndPostSupplierReturnResult = {
  returnId: string;
  /** True when refund was requested but the combined RPC is missing (plain post succeeded). */
  refundSkipped: boolean;
};

export type RecordSupplierReturnRefundInput = {
  accountId: string;
  amount: number;
  occurredAt?: string | null;
  comment?: string | null;
};

export function createSupplierReturn(input: CreateSupplierReturnInput, workspaceId: string | undefined) {
  return createOp(
    "supplierReturn",
    workspaceId,
    {
      warehouse_id: input.warehouseId,
      goods_receipt_id: input.goodsReceiptId?.trim() || null,
      supplier_name: normalizeSupplierName(input.supplierName),
      reason: input.reason?.trim() || null,
      comment: input.comment?.trim() || null,
    },
    input.lines,
  );
}

async function postOp(kind: WarehouseOpKind, id: string) {
  const config = configs[kind];
  const { error } = await supabase.rpc(config.postRpc, { [config.postArg]: id });
  if (error) throw mapWarehouseOpsError(error, "inventory.ops.errors.postFailed");
}

async function deleteSupplierReturnDraft(returnId: string, workspaceId: string) {
  const config = configs.supplierReturn;
  await supabase.from(config.lines).delete().eq(config.fk, returnId).eq("workspace_id", workspaceId);
  await supabase.from(config.doc).delete().eq("id", returnId).eq("workspace_id", workspaceId);
}

const SUPPLIER_RETURN_REFUND_CODES = [
  "forbidden",
  "not_posted",
  "already_refunded",
  "amount_positive",
  "amount_exceeds_total",
  "account_invalid",
  "account_no_income",
  "currency_mismatch",
  "not_found",
] as const;

type SupplierReturnRefundCode = (typeof SUPPLIER_RETURN_REFUND_CODES)[number];

function parseSupplierReturnRefundCode(message: string | undefined): SupplierReturnRefundCode | null {
  const match = /supplier_return_refund:([a-z_]+)/i.exec(message ?? "");
  if (!match) return null;
  const code = match[1] as SupplierReturnRefundCode;
  return (SUPPLIER_RETURN_REFUND_CODES as readonly string[]).includes(code) ? code : null;
}

function supplierReturnRefundMessage(code: SupplierReturnRefundCode, details?: string | null) {
  switch (code) {
    case "forbidden":
      return i18n.t("inventory.supplierReturn.refund.errors.forbidden");
    case "not_posted":
      return i18n.t("inventory.supplierReturn.refund.errors.notPosted");
    case "already_refunded":
      return i18n.t("inventory.supplierReturn.refund.errors.alreadyRefunded");
    case "amount_positive":
      return i18n.t("inventory.supplierReturn.refund.errors.amountPositive");
    case "amount_exceeds_total": {
      const total = toNum(details);
      return i18n.t("inventory.supplierReturn.refund.errors.amountExceeds", {
        total: Number.isFinite(total) ? total : details ?? "?",
      });
    }
    case "account_invalid":
      return i18n.t("inventory.supplierReturn.refund.errors.accountInvalid");
    case "account_no_income":
      return i18n.t("inventory.supplierReturn.refund.errors.accountNoIncome");
    case "currency_mismatch":
      return i18n.t("inventory.supplierReturn.refund.errors.currencyMismatch");
    case "not_found":
      return i18n.t("inventory.supplierReturn.refund.errors.notFound");
  }
}

/** Maps supplier_return_refund:* RPC errors to localized copy. */
export function mapSupplierReturnRefundError(error: DbError) {
  const code = parseSupplierReturnRefundCode(error.message);
  if (code) {
    return new Error(supplierReturnRefundMessage(code, error.details));
  }
  if (isMissingRpcError(error)) {
    return new Error(i18n.t("inventory.ops.errors.supplierReturnRpcMissing"));
  }
  if (isPermissionError(error)) {
    return new Error(i18n.t("inventory.supplierReturn.refund.errors.forbidden"));
  }
  const cleaned = cleanRpcMessage(error.message);
  if (cleaned) return new Error(cleaned);
  return new Error(i18n.t("inventory.ops.errors.postFailed"));
}

async function postSupplierReturnWithOptionalRefund(
  returnId: string,
  refund: SupplierReturnRefundInput | null | undefined,
): Promise<{ refundSkipped: boolean }> {
  if (!refund?.accountId.trim()) {
    await postOp("supplierReturn", returnId);
    return { refundSkipped: false };
  }

  const { error } = await supabase.rpc("crm_post_supplier_return_with_refund", {
    p_return_id: returnId,
    p_account_id: refund.accountId.trim(),
    p_amount: refund.amount == null || !Number.isFinite(refund.amount) ? null : refund.amount,
    p_comment: refund.comment?.trim() || null,
  });

  if (!error) return { refundSkipped: false };

  if (isMissingRpcError(error)) {
    // Combined RPC not applied yet — post the return and let the UI warn about skipped money.
    await postOp("supplierReturn", returnId);
    return { refundSkipped: true };
  }

  if (parseSupplierReturnRefundCode(error.message)) {
    throw mapSupplierReturnRefundError(error);
  }
  throw mapWarehouseOpsError(error, "inventory.ops.errors.postFailed");
}

/**
 * Creates a draft supplier return and posts it (optionally with a refund income).
 * On post failure the draft is deleted so the user can retry cleanly.
 */
export async function createAndPostSupplierReturn(
  input: CreateSupplierReturnInput,
  workspaceId: string | undefined,
): Promise<CreateAndPostSupplierReturnResult> {
  const resolved = requireWorkspaceId(workspaceId);
  const { refund, ...draftInput } = input;
  const returnId = await createSupplierReturn(draftInput, resolved);
  try {
    const { refundSkipped } = await postSupplierReturnWithOptionalRefund(returnId, refund);
    return { returnId, refundSkipped };
  } catch (error) {
    await deleteSupplierReturnDraft(returnId, resolved);
    throw error;
  }
}

/** Records money received back from the supplier for an already posted return (once). */
export async function recordSupplierReturnRefund(
  returnId: string,
  input: RecordSupplierReturnRefundInput,
) {
  const id = returnId.trim();
  if (!id) throw new Error(i18n.t("inventory.supplierReturn.refund.errors.notFound"));

  const { error } = await supabase.rpc("crm_record_supplier_return_refund", {
    p_return_id: id,
    p_account_id: input.accountId.trim(),
    p_amount: input.amount,
    p_occurred_at: input.occurredAt?.trim() || null,
    p_comment: input.comment?.trim() || null,
  });
  if (error) throw mapSupplierReturnRefundError(error);
}

export async function getSupplierReturns(workspaceId: string | undefined) {
  return (await listOps("supplierReturn", workspaceId)) as WarehouseOpsResult<SupplierReturnRecord>;
}

/** Posted returns for one goods receipt → inventory_item_id → returned quantity. */
export async function getReturnedQuantitiesForReceipt(
  workspaceId: string | undefined,
  receiptId: string,
): Promise<Map<string, number>> {
  const resolved = requireWorkspaceId(workspaceId);
  const result = new Map<string, number>();
  const id = receiptId.trim();
  if (!id) return result;

  const config = configs.supplierReturn;
  const { data: returns, error: returnsError } = await supabase
    .from(config.doc)
    .select("id")
    .eq("workspace_id", resolved)
    .eq("goods_receipt_id", id)
    .is("deleted_at", null)
    .not("posted_at", "is", null);
  if (returnsError) {
    if (isMissingTableError(returnsError, config.doc)) return result;
    throw new Error(returnsError.message);
  }

  const returnIds = ((returns ?? []) as { id?: unknown }[]).map((row) => String(row.id)).filter(Boolean);
  if (returnIds.length === 0) return result;

  const { rows: lineRows, error: linesError } = await selectInChunks<Record<string, unknown>>(returnIds, (chunk) =>
    supabase
      .from(config.lines)
      .select("inventory_item_id, quantity")
      .eq("workspace_id", resolved)
      .in("supplier_return_id", chunk),
  );
  if (linesError) {
    if (isMissingTableError(linesError, config.lines)) return result;
    throw new Error(linesError.message);
  }

  for (const row of lineRows) {
    const itemId = toId(row.inventory_item_id);
    if (!itemId) continue;
    result.set(itemId, roundQtySafe((result.get(itemId) ?? 0) + toNum(row.quantity)));
  }
  return result;
}

function roundQtySafe(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Supplier returns whose supplier_name matches (escaped case-insensitive). */
export async function getSupplierReturnsForSupplier(workspaceId: string | undefined, supplierName: string) {
  const resolved = requireWorkspaceId(workspaceId);
  const name = supplierName.trim();
  if (!name) return [] as SupplierReturnRecord[];

  const config = configs.supplierReturn;
  const { data, error } = await supabase
    .from(config.doc)
    .select("*")
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .ilike("supplier_name", escapeLikePattern(name))
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    if (isMissingTableError(error, config.doc)) return [];
    throw new Error(error.message);
  }

  const docs = (data ?? []) as Record<string, unknown>[];
  if (docs.length === 0) return [];

  const linesByDoc = new Map<string, Record<string, unknown>[]>();
  const itemIds = new Set<string>();
  const { rows: lineRows, error: linesError } = await selectInChunks<Record<string, unknown>>(
    docs.map((doc) => String(doc.id)),
    (chunk) =>
      supabase
        .from(config.lines)
        .select("*")
        .eq("workspace_id", resolved)
        .in(config.fk, chunk)
        .order("position", { ascending: true }),
  );
  if (linesError) {
    if (isMissingTableError(linesError, config.lines)) return [];
    throw new Error(linesError.message);
  }
  for (const row of lineRows) {
    const key = String(row[config.fk]);
    linesByDoc.set(key, [...(linesByDoc.get(key) ?? []), row]);
    if (row.inventory_item_id) itemIds.add(String(row.inventory_item_id));
  }

  const catalog = await getItemNames(resolved, [...itemIds]);
  return docs.map(
    (doc) =>
      toWarehouseOp(
        "supplierReturn",
        doc,
        (linesByDoc.get(String(doc.id)) ?? []).map((line) => toLine(line, catalog)),
      ) as SupplierReturnRecord,
  );
}

const SUPPLIER_DELIVERIES_PAGE_SIZE = 50;
const IN_FILTER_CHUNK_SIZE = 200;

/** Escapes `\`, `%`, and `_` so an `ilike` pattern behaves as exact case-insensitive equality. */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function emptySupplierDeliveriesPage(page: number, pageSize: number): SupplierDeliveriesPage {
  return {
    rows: [],
    page,
    pageSize,
    hasMore: false,
    totalCount: 0,
    postedTotal: 0,
    lastDeliveryAt: null,
  };
}

type DbResult<T> = { data: T[] | null; error: { message?: string; code?: string } | null };

/** Runs `.in()` queries in chunks of 200 ids and concatenates rows. */
async function selectInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => PromiseLike<DbResult<T>>,
): Promise<{ rows: T[]; error: { message?: string; code?: string } | null }> {
  if (ids.length === 0) return { rows: [], error: null };
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_FILTER_CHUNK_SIZE);
    const { data, error } = await fetchChunk(chunk);
    if (error) return { rows, error };
    if (data) rows.push(...data);
  }
  return { rows, error: null };
}

async function hydrateReceiptDocs(
  workspaceId: string,
  docs: Record<string, unknown>[],
): Promise<GoodsReceiptRecord[]> {
  if (docs.length === 0) return [];
  const config = configs.receipt;
  const linesByDoc = new Map<string, Record<string, unknown>[]>();
  const itemIds = new Set<string>();
  const docIds = docs.map((doc) => String(doc.id));

  const { rows: lineRows, error: linesError } = await selectInChunks<Record<string, unknown>>(docIds, (chunk) =>
    supabase
      .from(config.lines)
      .select("*")
      .eq("workspace_id", workspaceId)
      .in(config.fk, chunk)
      .order("position", { ascending: true }),
  );
  if (linesError) {
    if (isMissingTableError(linesError, config.lines)) return [];
    throw new Error(linesError.message);
  }
  for (const row of lineRows) {
    const key = String(row[config.fk]);
    linesByDoc.set(key, [...(linesByDoc.get(key) ?? []), row]);
    if (row.inventory_item_id) itemIds.add(String(row.inventory_item_id));
  }

  const names = await getItemNames(workspaceId, [...itemIds]);
  return docs.map(
    (doc) =>
      toWarehouseOp(
        "receipt",
        doc,
        (linesByDoc.get(String(doc.id)) ?? []).map((line) => toLine(line, names)),
      ) as GoodsReceiptRecord,
  );
}

function receiptHeaderSortKey(doc: Record<string, unknown>) {
  return toText(doc.received_at) || toText(doc.created_at) || "";
}

function receiptHeaderIsPosted(doc: Record<string, unknown>) {
  return doc.status !== "draft";
}

type SupplierReceiptHeader = {
  doc: Record<string, unknown>;
  matchedByLegacy: boolean;
};

/**
 * Goods receipts for a supplier: exact `supplier_name` match (case-insensitive) plus legacy
 * receipts with null supplier_name that include catalog lines from that supplier.
 */
export async function getSupplierDeliveries(
  workspaceId: string | undefined,
  supplierName: string,
  page = 1,
  pageSize = SUPPLIER_DELIVERIES_PAGE_SIZE,
): Promise<SupplierDeliveriesPage> {
  const resolved = requireWorkspaceId(workspaceId);
  const name = supplierName.trim();
  if (!name) return emptySupplierDeliveriesPage(1, pageSize);

  const config = configs.receipt;
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize) || SUPPLIER_DELIVERIES_PAGE_SIZE));
  const likePattern = escapeLikePattern(name);

  // Exact match (case-insensitive). Escaped pattern ≈ lower(col) = lower(value).
  const { data: exactRows, error: exactError } = await supabase
    .from(config.doc)
    .select("*")
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .ilike("supplier_name", likePattern)
    .order("received_at", { ascending: false });
  if (exactError) {
    if (isMissingTableError(exactError, config.doc)) return emptySupplierDeliveriesPage(safePage, safeSize);
    // Column missing: skip exact match and rely on legacy item-supplier fallback only.
    if (!isMissingSupplierNameColumn(exactError)) throw new Error(exactError.message);
  }

  const exactDocs = (exactRows ?? []) as Record<string, unknown>[];
  const exactIds = new Set(exactDocs.map((doc) => String(doc.id)));

  // Legacy: receipts with null supplier_name that use items from this supplier.
  const { data: itemRows, error: itemsError } = await supabase
    .from("inventory_items")
    .select("id")
    .eq("workspace_id", resolved)
    .ilike("supplier", likePattern);
  if (itemsError) throw new Error(itemsError.message);

  const itemIds = ((itemRows ?? []) as { id?: unknown }[]).map((row) => String(row.id)).filter(Boolean);
  let legacyDocs: Record<string, unknown>[] = [];
  if (itemIds.length > 0) {
    const { rows: legacyLineRows, error: legacyLinesError } = await selectInChunks<{ goods_receipt_id?: unknown }>(
      itemIds,
      (chunk) =>
        supabase
          .from(config.lines)
          .select("goods_receipt_id")
          .eq("workspace_id", resolved)
          .in("inventory_item_id", chunk),
    );
    if (legacyLinesError) {
      if (!isMissingTableError(legacyLinesError, config.lines)) throw new Error(legacyLinesError.message);
    } else {
      const legacyReceiptIds = [
        ...new Set(
          legacyLineRows
            .map((row) => String(row.goods_receipt_id ?? ""))
            .filter((id) => id && !exactIds.has(id)),
        ),
      ];
      if (legacyReceiptIds.length > 0) {
        const { rows: legacyReceiptRows, error: legacyReceiptsError } = await selectInChunks<Record<string, unknown>>(
          legacyReceiptIds,
          (chunk) =>
            supabase
              .from(config.doc)
              .select("*")
              .eq("workspace_id", resolved)
              .is("deleted_at", null)
              .is("supplier_name", null)
              .in("id", chunk)
              .order("received_at", { ascending: false }),
        );
        if (legacyReceiptsError) throw new Error(legacyReceiptsError.message);
        legacyDocs = legacyReceiptRows;
      }
    }
  }

  const mergedHeaders: SupplierReceiptHeader[] = [
    ...exactDocs.map((doc) => ({ doc, matchedByLegacy: false })),
    ...legacyDocs.map((doc) => ({ doc, matchedByLegacy: true })),
  ].sort((a, b) => receiptHeaderSortKey(b.doc).localeCompare(receiptHeaderSortKey(a.doc)));

  const totalCount = mergedHeaders.length;
  const postedTotal = mergedHeaders.reduce(
    (sum, header) => (receiptHeaderIsPosted(header.doc) ? sum + toNum(header.doc.total) : sum),
    0,
  );
  const lastDeliveryAt = mergedHeaders[0] ? receiptHeaderSortKey(mergedHeaders[0].doc) || null : null;

  const start = (safePage - 1) * safeSize;
  const pageHeaders = mergedHeaders.slice(start, start + safeSize);
  const hydrated = await hydrateReceiptDocs(
    resolved,
    pageHeaders.map((header) => header.doc),
  );
  const rows: SupplierDelivery[] = hydrated.map((row, index) => ({
    ...row,
    matchedByLegacy: pageHeaders[index]?.matchedByLegacy ?? false,
  }));

  return {
    rows,
    page: safePage,
    pageSize: safeSize,
    hasMore: start + safeSize < totalCount,
    totalCount,
    postedTotal,
    lastDeliveryAt,
  };
}

/** Catalog parts with this supplier (same filter as the Inventory supplier dropdown). */
export async function getSupplierParts(workspaceId: string | undefined, supplierName: string) {
  const name = supplierName.trim();
  if (!name) return [];
  return getInventoryItems(undefined, "all", { field: "name", ascending: true }, workspaceId, name);
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
/** Decreases stock via receipt batches or FIFO; no finance entries. */
export const postSupplierReturn = (returnId: string) => postOp("supplierReturn", returnId);
