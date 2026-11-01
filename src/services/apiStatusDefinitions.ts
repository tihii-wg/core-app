import i18n from "../i18n";
import { isMissingTableError } from "./missingTable";
import supabase from "./supabase";

export type StatusEntity = "order" | "estimate" | "lead" | "invoice" | "transfer" | "task";

export type StatusDefinition = {
  id: string;
  workspaceId: string;
  entity: StatusEntity;
  name: string;
  color: string | null;
  statusGroup: string;
  systemStatus: string | null;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  showOverdueBadge: boolean;
  addsToBackorders: boolean;
};

const statusColumns =
  "id, workspace_id, entity, name, color, status_group, system_status, sort_order, is_default, is_active, show_overdue_badge, adds_to_backorders, deleted_at";

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

function isMissingStatusTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /status_definitions/i.test(error.message ?? "");
}

export function toStatusDefinition(row: Record<string, unknown>): StatusDefinition {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    entity: row.entity as StatusEntity,
    name: typeof row.name === "string" ? row.name : "",
    color: typeof row.color === "string" ? row.color : null,
    statusGroup: typeof row.status_group === "string" ? row.status_group : "new",
    systemStatus: typeof row.system_status === "string" ? row.system_status : null,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    isDefault: Boolean(row.is_default),
    isActive: row.is_active !== false,
    showOverdueBadge: Boolean(row.show_overdue_badge),
    addsToBackorders: Boolean(row.adds_to_backorders),
  };
}

export async function getStatusDefinitions(workspaceId: string | undefined, entity?: StatusEntity) {
  const resolved = requireWorkspaceId(workspaceId);
  let query = supabase
    .from("status_definitions")
    .select(statusColumns)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (entity) query = query.eq("entity", entity);

  const { data, error } = await query;
  if (error) {
    if (isMissingStatusTable(error)) return [] as StatusDefinition[];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toStatusDefinition);
}

/** Map of fromStatusId -> allowed next status ids. Empty when `status_transitions` is not applied yet. */
export async function getStatusTransitions(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const map = new Map<string, Set<string>>();

  const { data, error } = await supabase
    .from("status_transitions")
    .select("status_id, next_status_id")
    .eq("workspace_id", resolved);

  if (error) {
    if (isMissingTableError(error, "status_transitions")) return map;
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    if (typeof row.status_id !== "string" || typeof row.next_status_id !== "string") continue;
    const set = map.get(row.status_id) ?? new Set<string>();
    set.add(row.next_status_id);
    map.set(row.status_id, set);
  }
  return map;
}

/**
 * Pure transition rule for custom (board) statuses.
 * - No change, or no source custom status -> allowed.
 * - Source without configured transitions (or table unavailable -> empty map) -> allowed.
 * - Source with transitions: moving to a system-only column (null) is forbidden; otherwise target must be in the set.
 */
export function isCustomStatusTransitionAllowed(
  transitions: Map<string, Set<string>>,
  fromCustomStatusId: string | null,
  toCustomStatusId: string | null,
) {
  if (!fromCustomStatusId || fromCustomStatusId === toCustomStatusId) return true;
  const next = transitions.get(fromCustomStatusId);
  if (!next || next.size === 0) return true;
  if (!toCustomStatusId) return false;
  return next.has(toCustomStatusId);
}

/** Throws an i18n error when the configured workflow forbids moving between the two custom statuses. */
export async function assertCustomStatusTransition(
  workspaceId: string | undefined,
  fromCustomStatusId: string | null,
  toCustomStatusId: string | null,
) {
  if (!fromCustomStatusId || fromCustomStatusId === toCustomStatusId) return;
  const transitions = await getStatusTransitions(workspaceId);
  if (!isCustomStatusTransitionAllowed(transitions, fromCustomStatusId, toCustomStatusId)) {
    throw new Error(i18n.t("orders.board.errors.transitionForbidden"));
  }
}

export async function getStatusDefinitionsByIds(workspaceId: string | undefined, ids: string[]) {
  const resolved = requireWorkspaceId(workspaceId);
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map<string, StatusDefinition>();

  const { data, error } = await supabase
    .from("status_definitions")
    .select(statusColumns)
    .eq("workspace_id", resolved)
    .in("id", unique)
    .is("deleted_at", null);

  if (error) {
    if (isMissingStatusTable(error)) return new Map<string, StatusDefinition>();
    throw new Error(error.message);
  }

  const map = new Map<string, StatusDefinition>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const status = toStatusDefinition(row);
    map.set(status.id, status);
  }
  return map;
}

export const STATUS_GROUPS = [
  "new",
  "in_progress",
  "pending",
  "delivery",
  "done",
  "paid",
  "closed",
  "dropped_off",
  "canceled",
] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export type CreateStatusDefinitionInput = {
  entity?: StatusEntity;
  name: string;
  color?: string | null;
  statusGroup: StatusGroup;
  systemStatus?: string | null;
  sortOrder?: number;
};

/** Creates a status definition (defaults to the `order` entity). */
export async function createStatusDefinition(input: CreateStatusDefinitionInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const name = input.name.trim();
  if (!name) throw new Error(i18n.t("settings.statuses.errors.nameRequired"));
  const systemStatus = input.systemStatus?.trim() || null;
  const color = input.color?.trim() || null;

  const { data, error } = await supabase
    .from("status_definitions")
    .insert({
      workspace_id: resolved,
      entity: input.entity ?? "order",
      name,
      color,
      status_group: input.statusGroup,
      system_status: systemStatus,
      sort_order: Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder as number) : 0,
    })
    .select(statusColumns)
    .single();

  if (error) {
    if (isMissingStatusTable(error)) throw new Error(i18n.t("settings.statuses.errors.unavailable"));
    if (error.code === "23505") throw new Error(i18n.t("settings.statuses.errors.duplicate"));
    throw new Error(error.message);
  }
  return toStatusDefinition(data as Record<string, unknown>);
}
