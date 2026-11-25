import i18n from "../i18n";
import supabase from "./supabase";
import { isMissingRpcError } from "./missingRpc";
import { requireWorkspaceId } from "./missingTable";
import { createAndPostGoodsReceipt } from "./apiWarehouseOps";
import type { RoParsed } from "../features/import/roImportParse";

export type RoImportOptions = {
  /** Clients: write RO balances as opening balance entries. */
  withBalances?: boolean;
  /** Parts: post one goods receipt with the RO stock into this warehouse. */
  stockWarehouseId?: string | null;
  /**
   * Parts: also post the RO stock for parts that already exist in the app with zero quantity
   * (needs 20261125150000_ro_import_stock_existing). Parts that already hold stock are never topped up.
   */
  stockForExisting?: boolean;
  /** Orders: record the paid amount as a payment. */
  withPayments?: boolean;
};

export type RoImportProgress = { done: number; total: number };

export type RoImportResult = {
  created: number;
  linked: number;
  skipped: number;
  duplicates: number;
  vehicles: number;
  clients: number;
  lines: number;
  payments: number;
  balances: number;
  stockItems: number;
  /** Existing parts left alone because they already hold stock. */
  stockSkipped: number;
};

/** Rows per call: one call = one transaction on the server; sized to stay well under request limits. */
const CHUNK = { clients: 250, catalog: 500, orders: 80 } as const;

const RPC = {
  clients: "crm_import_clients",
  catalog: "crm_import_catalog",
  orders: "crm_import_orders",
} as const;

export class RoImportNotInstalledError extends Error {
  constructor() {
    super(i18n.t("settings.importData.errors.notInstalled"));
  }
}

function mapImportError(error: { message?: string; code?: string }): Error {
  const message = error.message ?? "";
  if (/import:forbidden|import:not_authenticated/.test(message)) return new Error(i18n.t("settings.importData.errors.forbidden"));
  if (/import:replica_not_allowed/.test(message)) return new Error(i18n.t("settings.importData.errors.replica"));
  return new Error(message || i18n.t("settings.importData.errors.failed"));
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function emptyResult(): RoImportResult {
  return { created: 0, linked: 0, skipped: 0, duplicates: 0, vehicles: 0, clients: 0, lines: 0, payments: 0, balances: 0, stockItems: 0, stockSkipped: 0 };
}

function addStats(total: RoImportResult, stats: Record<string, unknown> | null) {
  if (!stats) return;
  const num = (key: string) => (typeof stats[key] === "number" ? (stats[key] as number) : 0);
  total.created += num("created");
  total.linked += num("linked");
  total.skipped += num("skipped");
  total.duplicates += num("duplicates");
  total.vehicles += num("vehicles");
  total.clients += num("clients");
  total.lines += num("lines");
  total.payments += num("payments");
  total.balances += num("balances");
  total.stockSkipped += num("stock_skipped");
}

/**
 * Sends the parsed rows to the import RPCs chunk by chunk (sequential: a later chunk may rely on clients /
 * catalog items created by an earlier one). Re-running the same file is safe — the server skips imported rows.
 */
export async function runRoImport(
  parsed: RoParsed,
  workspaceId: string | undefined,
  options: RoImportOptions = {},
  onProgress?: (progress: RoImportProgress) => void,
): Promise<RoImportResult> {
  const ws = requireWorkspaceId(workspaceId);
  const result = emptyResult();
  const total = parsed.rows.length;
  let done = 0;
  onProgress?.({ done, total });

  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      if ("p_stock_existing" in args && isMissingRpcError(error, name)) throw new Error(i18n.t("settings.importData.errors.stockExistingNotInstalled"));
      if (isMissingRpcError(error, name)) throw new RoImportNotInstalledError();
      throw mapImportError(error);
    }
    return (data ?? null) as Record<string, unknown> | null;
  };

  const stock: Array<{ id: string; name: string; qty: number; cost: number }> = [];

  if (parsed.kind === "people" || parsed.kind === "organizations") {
    for (const part of chunks(parsed.rows, CHUNK.clients)) {
      addStats(result, await call(RPC.clients, { p_workspace_id: ws, p_rows: part, p_with_balance: Boolean(options.withBalances) }));
      done += part.length;
      onProgress?.({ done, total });
    }
  } else if (parsed.kind === "services" || parsed.kind === "materials") {
    for (const part of chunks(parsed.rows as readonly unknown[], CHUNK.catalog)) {
      const stats = await call(RPC.catalog, {
        p_workspace_id: ws,
        p_kind: parsed.kind,
        p_rows: part,
        // Sent only when asked: older databases have the 3-argument function.
        ...(parsed.kind === "materials" && options.stockWarehouseId && options.stockForExisting ? { p_stock_existing: true } : {}),
      });
      addStats(result, stats);
      if (Array.isArray(stats?.stock)) {
        for (const item of stats.stock as Array<{ id: string; name: string; qty: number; cost: number }>) stock.push(item);
      }
      done += part.length;
      onProgress?.({ done, total });
    }
  } else if (parsed.kind === "orders") {
    for (const part of chunks(parsed.rows, CHUNK.orders)) {
      addStats(result, await call(RPC.orders, { p_workspace_id: ws, p_rows: part, p_with_payments: options.withPayments !== false }));
      done += part.length;
      onProgress?.({ done, total });
    }
  }

  // Opening stock goes through the normal warehouse flow (one posted goods receipt) so balances, batches and the
  // movement history stay consistent with everything else in the app.
  if (parsed.kind === "materials" && options.stockWarehouseId && stock.length > 0) {
    // One line per item: the same part can come back from several rows (same name) — quantities add up.
    const byId = new Map<string, { id: string; name: string; qty: number; cost: number }>();
    for (const item of stock) {
      const current = byId.get(item.id);
      byId.set(item.id, current ? { ...current, qty: current.qty + item.qty } : { ...item });
    }
    const lines = [...byId.values()];
    await createAndPostGoodsReceipt(
      {
        warehouseId: options.stockWarehouseId,
        comment: i18n.t("settings.importData.stockReceiptComment"),
        lines: lines.map((item) => ({ inventoryItemId: item.id, itemName: item.name, quantity: item.qty, unitCost: item.cost })),
      },
      ws,
    );
    result.stockItems = lines.length;
  }

  return result;
}
