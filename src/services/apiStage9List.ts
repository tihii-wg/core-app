import i18n from "../i18n";
import supabase from "./supabase";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";

export const STAGE9_LIST_LIMIT = 200;

export type Stage9ListResult<T> = {
  rows: T[];
  /** True when the table is not applied in this database yet (crm_ro_v1.PRODUCTION.sql). */
  isUnavailable: boolean;
};

/**
 * Shared list query for the Stage 9 modules (writes live in the helpers below). Newest first, soft-deleted rows excluded.
 * A missing table resolves to `{ rows: [], isUnavailable: true }`; any other error is thrown.
 */
export async function listStage9Rows<T>(
  table: string,
  columns: string,
  workspaceId: string | undefined,
  orderColumn: string,
  ascending: boolean,
  mapRow: (row: Record<string, unknown>) => T,
): Promise<Stage9ListResult<T>> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("workspace_id", id)
    .is("deleted_at", null)
    .order(orderColumn, { ascending })
    .limit(STAGE9_LIST_LIMIT);

  if (error) {
    if (isMissingTableError(error, table)) return { rows: [], isUnavailable: true };
    throw new Error(error.message);
  }
  return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(mapRow), isUnavailable: false };
}

export function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function num(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

type DbError = { code?: string; message?: string } | null | undefined;

/** PGRST204 (column not in schema cache) / 42703 (undefined_column) mentioning `column`. */
function isMissingColumnError(error: DbError, column: string) {
  if (!error) return false;
  const message = error.message ?? "";
  if (!new RegExp(`\\b${column}\\b`, "i").test(message)) return false;
  return error.code === "PGRST204" || error.code === "42703" || /schema cache|does not exist/i.test(message);
}

function mapWriteError(error: NonNullable<DbError>, table: string) {
  if (isMissingTableError(error, table)) return new Error(i18n.t("stage9.errors.unavailable", { table }));
  // 42501 = RLS / privilege denied (crm_ro_v1 gates writes on e.g. leads.create / tasks.edit permissions).
  if (error.code === "42501") return new Error(i18n.t("stage9.errors.noPermission"));
  return new Error(error.message ?? i18n.t("common.somethingWentWrong"));
}

/** Inserts a row into a Stage 9 table (workspace_id is added here). RLS decides who may write. */
export async function insertStage9Row(table: string, row: Record<string, unknown>, workspaceId: string | undefined) {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.from(table).insert({ ...row, workspace_id: id }).select("id").single();
  if (error) throw mapWriteError(error, table);
  return data as { id: string };
}

/** Updates a live (not soft-deleted) Stage 9 row. Throws when nothing matched (RLS denial or already deleted). */
export async function updateStage9Row(
  table: string,
  rowId: string,
  patch: Record<string, unknown>,
  workspaceId: string | undefined,
) {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from(table)
    .update(patch)
    .eq("workspace_id", id)
    .eq("id", rowId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw mapWriteError(error, table);
  if (!data || data.length === 0) throw new Error(i18n.t("stage9.errors.notFound"));
}

/**
 * Soft-deletes a row by setting `deleted_at`. If the table has no such column (older shape) it falls back
 * to a hard delete, so the action still works.
 */
export async function deleteStage9Row(table: string, rowId: string, workspaceId: string | undefined) {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", id)
    .eq("id", rowId)
    .is("deleted_at", null)
    .select("id");

  if (error && isMissingColumnError(error, "deleted_at")) {
    const { error: hardError } = await supabase.from(table).delete().eq("workspace_id", id).eq("id", rowId);
    if (hardError) throw mapWriteError(hardError, table);
    return;
  }
  if (error) throw mapWriteError(error, table);
  if (!data || data.length === 0) throw new Error(i18n.t("stage9.errors.notFound"));
}

/**
 * Default status for a new record: the workspace's `is_default` status for the entity, else the first
 * active one by sort order. Best-effort: returns null when `status_definitions` is unavailable or empty.
 */
export async function resolveDefaultStatusId(
  entity: "lead" | "estimate" | "task",
  workspaceId: string | undefined,
): Promise<string | null> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("status_definitions")
    .select("id, is_default, is_active, sort_order")
    .eq("workspace_id", id)
    .eq("entity", entity)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error || !data) return null;
  const rows = (data as { id: string; is_default: boolean | null; is_active: boolean | null }[]).filter(
    (row) => row.is_active !== false,
  );
  return (rows.find((row) => row.is_default) ?? rows[0])?.id ?? null;
}

export function nullIfBlank(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}
