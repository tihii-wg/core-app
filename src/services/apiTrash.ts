import i18n from "../i18n";
import supabase from "./supabase";

/** Kinds of soft-deleted records the trash holds (SQL 20261125213000_trash). */
export type TrashKind = "client" | "vehicle" | "template" | "task" | "workspace";

export type TrashItem = {
  kind: TrashKind;
  id: string;
  title: string;
  subtitle: string | null;
  deletedAt: string;
  /** False for merged clients: their orders now belong to the surviving client. */
  restorable: boolean;
  merged: boolean;
};

export type TrashPurgeResult = { deleted: number; kept: number; workspaces: number };

/** Days an item stays in the trash before the scheduler removes it. */
export const TRASH_RETENTION_DAYS = 90;

export class TrashUnavailableError extends Error {}

function trashError(error: { code?: string; message?: string } | null): Error {
  const message = error?.message ?? "";
  if (error?.code === "PGRST202" || (/crm_trash_/.test(message) && /function|schema cache/i.test(message))) {
    return new TrashUnavailableError(i18n.t("settings.trash.errors.sqlMissing"));
  }
  if (/trash:forbidden/.test(message)) return new Error(i18n.t("settings.trash.errors.forbidden"));
  if (/trash:not_found/.test(message)) return new Error(i18n.t("settings.trash.errors.notFound"));
  return new Error(message || i18n.t("common.somethingWentWrong"));
}

function toItem(row: Record<string, unknown>): TrashItem {
  return {
    kind: String(row.kind) as TrashKind,
    id: String(row.id),
    title: typeof row.title === "string" && row.title.trim() ? row.title : "—",
    subtitle: typeof row.subtitle === "string" && row.subtitle.trim() ? row.subtitle : null,
    deletedAt: String(row.deleted_at ?? ""),
    restorable: row.restorable !== false,
    merged: row.merged === true,
  };
}

/** Trash of the workspace plus the caller's own deleted workspaces (owner only). One RPC. */
export async function getTrash(workspaceId: string): Promise<TrashItem[]> {
  const { data, error } = await supabase.rpc("crm_trash_list", { p_workspace_id: workspaceId });
  if (error) throw trashError(error);
  return Array.isArray(data) ? (data as Record<string, unknown>[]).map(toItem) : [];
}

export async function restoreTrashItem(workspaceId: string, kind: TrashKind, id: string): Promise<void> {
  const { error } = await supabase.rpc("crm_trash_restore", { p_workspace_id: workspaceId, p_kind: kind, p_id: id });
  if (error) throw trashError(error);
}

/** One item (kind + id) or, without them, the whole trash. */
export async function purgeTrash(
  workspaceId: string,
  target: { kind: TrashKind; id: string } | null,
): Promise<TrashPurgeResult> {
  const { data, error } = await supabase.rpc("crm_trash_purge", {
    p_workspace_id: workspaceId,
    p_kind: target?.kind ?? null,
    p_id: target?.id ?? null,
  });
  if (error) throw trashError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    deleted: Number(row.deleted ?? 0) || 0,
    kept: Number(row.kept ?? 0) || 0,
    workspaces: Number(row.workspaces ?? 0) || 0,
  };
}

/** Whole days left before automatic removal (never negative). */
export function trashDaysLeft(deletedAt: string, now: Date = new Date()): number {
  const deleted = new Date(deletedAt).getTime();
  if (!Number.isFinite(deleted)) return TRASH_RETENTION_DAYS;
  const elapsed = Math.floor((now.getTime() - deleted) / 86_400_000);
  return Math.max(0, TRASH_RETENTION_DAYS - elapsed);
}
