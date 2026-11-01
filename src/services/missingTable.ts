import i18n from "../i18n";

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * True when a PostgREST/Postgres error means the table (or relation) is absent from the connected database
 * (PGRST205 schema-cache miss / 42P01 undefined_table). Used so optional RO-migration tables degrade to empty states.
 */
export function isMissingTableError(error: DbError, table?: string) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return Boolean(table) && new RegExp(`\\b${table}\\b`, "i").test(error.message ?? "") && /schema cache|does not exist/i.test(error.message ?? "");
}

export function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}
