import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

/**
 * Migration dry-run preview (Stages 7–8 foundation).
 *
 * READ-ONLY and Core-App-only: it counts rows that already live in THIS Core App database for the active workspace
 * (the future target of the RO App import). It never talks to RO App, never writes, never sends SMS/email.
 * Tables that are not applied yet degrade to `missing`; tables closed to the browser (RLS/grants) show `restricted`.
 */

export type MigrationPreviewGroup = "core" | "roSchema" | "tooling";

export type MigrationPreviewStatus = "ok" | "missing" | "restricted" | "error";

export type MigrationPreviewTable = {
  table: string;
  group: MigrationPreviewGroup;
  /** Try `deleted_at is null` first; fall back to a plain count if the column does not exist. */
  softDelete?: boolean;
};

export type MigrationPreviewRow = {
  table: string;
  group: MigrationPreviewGroup;
  status: MigrationPreviewStatus;
  count: number | null;
  message?: string;
};

export const MIGRATION_PREVIEW_TABLES: readonly MigrationPreviewTable[] = [
  // Source-of-truth Core tables that exist today.
  { table: "clients", group: "core", softDelete: true },
  { table: "vehicles", group: "core", softDelete: true },
  { table: "orders", group: "core" },
  { table: "services", group: "core" },
  { table: "inventory_items", group: "core" },
  { table: "employees", group: "core" },
  { table: "payments", group: "core" },
  { table: "invoices", group: "core" },
  { table: "expenses", group: "core" },
  // Tables created by supabase/manual/crm_ro_v1*.sql (import targets).
  { table: "locations", group: "roSchema", softDelete: true },
  { table: "warehouses", group: "roSchema", softDelete: true },
  { table: "categories", group: "roSchema", softDelete: true },
  { table: "roles", group: "roSchema" },
  { table: "status_definitions", group: "roSchema", softDelete: true },
  { table: "finance_accounts", group: "roSchema", softDelete: true },
  { table: "document_templates", group: "roSchema", softDelete: true },
  { table: "notification_rules", group: "roSchema", softDelete: true },
  { table: "client_phones", group: "roSchema" },
  { table: "order_events", group: "roSchema" },
  { table: "activity_log", group: "roSchema" },
  // Import bookkeeping. RLS gives the browser no access (service role only), so `restricted` is expected.
  { table: "migration_batches", group: "tooling" },
  { table: "migration_id_map", group: "tooling" },
  { table: "raw_ro_records", group: "tooling" },
];

type DbError = { code?: string; message?: string } | null;
type CountResult = { count: number | null; error: DbError };

function isMissingColumnError(error: DbError, column: string) {
  if (!error) return false;
  const columnError = error.code === "42703" || error.code === "PGRST204";
  return columnError && (error.message ?? "").includes(column);
}

function isPermissionError(error: DbError) {
  return Boolean(error) && (error?.code === "42501" || /permission denied/i.test(error?.message ?? ""));
}

function normalizeCount(count: number | null) {
  return typeof count === "number" && count >= 0 ? count : 0;
}

export function toPreviewRow(entry: MigrationPreviewTable, result: CountResult): MigrationPreviewRow {
  const base = { table: entry.table, group: entry.group };
  if (!result.error) return { ...base, status: "ok", count: normalizeCount(result.count) };
  if (isMissingTableError(result.error, entry.table)) return { ...base, status: "missing", count: null };
  if (isPermissionError(result.error)) return { ...base, status: "restricted", count: null };
  return { ...base, status: "error", count: null, message: result.error.message };
}

async function countTable(workspaceId: string, entry: MigrationPreviewTable): Promise<MigrationPreviewRow> {
  try {
    const base = () => supabase.from(entry.table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    if (entry.softDelete) {
      const filtered = await base().is("deleted_at", null);
      if (!isMissingColumnError(filtered.error, "deleted_at")) return toPreviewRow(entry, filtered);
    }
    return toPreviewRow(entry, await base());
  } catch (error) {
    return { table: entry.table, group: entry.group, status: "error", count: null, message: error instanceof Error ? error.message : undefined };
  }
}

/** Counts every preview table for the workspace. Never throws for per-table failures; only for a missing workspace. */
export async function getMigrationPreview(workspaceId: string | undefined) {
  const id = requireWorkspaceId(workspaceId);
  return Promise.all(MIGRATION_PREVIEW_TABLES.map((entry) => countTable(id, entry)));
}
