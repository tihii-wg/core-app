import i18n from "../i18n";
import {
  allocateStatusCode,
  fallbackCodeFromStatusId,
  isStatusCodeUniqueViolation,
  nextAvailableCode,
} from "../features/statuses/statusCodes";
import { isMissingTableError } from "./missingTable";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";
import supabase from "./supabase";

export type StatusEntity = "order" | "estimate" | "lead" | "invoice" | "transfer" | "task";

export type StatusSemanticAction = "normal" | "close" | "cancel";

export type StatusDefinition = {
  id: string;
  workspaceId: string;
  entity: StatusEntity;
  name: string;
  color: string | null;
  statusGroup: string;
  systemStatus: string | null;
  code: string | null;
  semanticAction: StatusSemanticAction;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  showOverdueBadge: boolean;
  addsToBackorders: boolean;
};

const statusColumns =
  "id, workspace_id, entity, name, color, status_group, system_status, code, semantic_action, sort_order, is_default, is_active, show_overdue_badge, adds_to_backorders, deleted_at";

/** Fallback select when code/semantic_action columns are not applied yet. */
const statusColumnsLegacy =
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

function isMissingLifecycleColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") {
    return /semantic_action|code/i.test(error.message ?? "");
  }
  return /semantic_action|code/i.test(error.message ?? "") && /schema cache|does not exist/i.test(error.message ?? "");
}

function toSemanticAction(value: unknown): StatusSemanticAction {
  return value === "close" || value === "cancel" ? value : "normal";
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
    code: typeof row.code === "string" ? row.code : null,
    semanticAction: toSemanticAction(row.semantic_action),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    isDefault: Boolean(row.is_default),
    isActive: row.is_active !== false,
    showOverdueBadge: Boolean(row.show_overdue_badge),
    addsToBackorders: Boolean(row.adds_to_backorders),
  };
}

async function selectDefinitions(workspaceId: string, entity?: StatusEntity) {
  let query = supabase
    .from("status_definitions")
    .select(statusColumns)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (entity) query = query.eq("entity", entity);
  const first = await query;
  if (!first.error) return first;
  if (isMissingLifecycleColumn(first.error)) {
    let legacy = supabase
      .from("status_definitions")
      .select(statusColumnsLegacy)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (entity) legacy = legacy.eq("entity", entity);
    return legacy;
  }
  return first;
}

export async function getStatusDefinitions(workspaceId: string | undefined, entity?: StatusEntity) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await selectDefinitions(resolved, entity);
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

  let rows: Record<string, unknown>[] | null = (data as Record<string, unknown>[] | null) ?? null;
  let err = error;
  if (err && isMissingLifecycleColumn(err)) {
    const legacy = await supabase
      .from("status_definitions")
      .select(statusColumnsLegacy)
      .eq("workspace_id", resolved)
      .in("id", unique)
      .is("deleted_at", null);
    rows = (legacy.data as Record<string, unknown>[] | null) ?? null;
    err = legacy.error;
  }

  if (err) {
    if (isMissingStatusTable(err)) return new Map<string, StatusDefinition>();
    throw new Error(err.message);
  }

  const map = new Map<string, StatusDefinition>();
  for (const row of rows ?? []) {
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

export type UpdateStatusDefinitionInput = {
  id: string;
  name?: string;
  color?: string | null;
  statusGroup?: StatusGroup;
  sortOrder?: number;
  isActive?: boolean;
};

/** Creates a status definition (defaults to the `order` entity). Always semantic normal. */
export async function createStatusDefinition(input: CreateStatusDefinitionInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const name = input.name.trim();
  if (!name) throw new Error(i18n.t("settings.statuses.errors.nameRequired"));
  const systemStatus = input.systemStatus?.trim() || null;
  const color = input.color?.trim() || null;
  const entity = input.entity ?? "order";

  // Pre-allocate a unique code among siblings (system_status is NOT unique).
  const siblings = await getStatusDefinitions(resolved, entity);
  const taken = new Set(siblings.map((s) => s.code).filter((c): c is string => Boolean(c)));
  const provisionalId = crypto.randomUUID();
  let code = allocateStatusCode({
    statusId: provisionalId,
    systemStatus,
    existingCode: null,
    takenCodes: taken,
  });

  const payload: Record<string, unknown> = {
    id: provisionalId,
    workspace_id: resolved,
    entity,
    name,
    color,
    status_group: input.statusGroup,
    system_status: systemStatus,
    code,
    sort_order: Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder as number) : 0,
    semantic_action: "normal",
  };

  let { data, error } = await supabase.from("status_definitions").insert(payload).select(statusColumns).single();

  // Concurrent create may race on a preferred canonical code — retry once with UUID fallback.
  // Preserve the same status UUID. Do not mask name-uniqueness violations.
  if (error && isStatusCodeUniqueViolation(error)) {
    taken.add(String(payload.code));
    code = nextAvailableCode(fallbackCodeFromStatusId(provisionalId), taken);
    payload.code = code;
    ({ data, error } = await supabase.from("status_definitions").insert(payload).select(statusColumns).single());
  }

  if (error && isMissingLifecycleColumn(error)) {
    delete payload.semantic_action;
    delete payload.code;
    delete payload.id;
    ({ data, error } = await supabase.from("status_definitions").insert(payload).select(statusColumnsLegacy).single());
  }

  if (error) {
    if (isMissingStatusTable(error)) throw new Error(i18n.t("settings.statuses.errors.unavailable"));
    if (error.code === "23505") throw new Error(i18n.t("settings.statuses.errors.duplicate"));
    throw new Error(error.message);
  }
  return toStatusDefinition(data as Record<string, unknown>);
}

export async function updateStatusDefinition(input: UpdateStatusDefinitionInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error(i18n.t("settings.statuses.errors.nameRequired"));
    patch.name = name;
  }
  if (input.color !== undefined) patch.color = input.color?.trim() || null;
  if (input.statusGroup !== undefined) patch.status_group = input.statusGroup;
  if (input.sortOrder !== undefined) patch.sort_order = Math.trunc(input.sortOrder);
  if (input.isActive !== undefined) {
    patch.is_active = input.isActive;
    if (!input.isActive) patch.is_default = false;
  }

  const { data, error } = await supabase
    .from("status_definitions")
    .update(patch)
    .eq("id", input.id)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .select(statusColumns)
    .maybeSingle();

  if (error) {
    if (isMissingLifecycleColumn(error)) {
      const legacy = await supabase
        .from("status_definitions")
        .update(patch)
        .eq("id", input.id)
        .eq("workspace_id", resolved)
        .is("deleted_at", null)
        .select(statusColumnsLegacy)
        .maybeSingle();
      if (legacy.error) {
        if (legacy.error.code === "23505") throw new Error(i18n.t("settings.statuses.errors.duplicate"));
        throw new Error(legacy.error.message);
      }
      if (!legacy.data) throw new Error(i18n.t("settings.statuses.errors.notFound"));
      return toStatusDefinition(legacy.data as Record<string, unknown>);
    }
    if (error.code === "23505") throw new Error(i18n.t("settings.statuses.errors.duplicate"));
    throw new Error(error.message);
  }
  if (!data) throw new Error(i18n.t("settings.statuses.errors.notFound"));
  return toStatusDefinition(data as Record<string, unknown>);
}

/** Sets exactly one default order status for the workspace. */
export async function setDefaultStatusDefinition(statusId: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data: target, error: loadError } = await supabase
    .from("status_definitions")
    .select("id, entity, is_active, semantic_action")
    .eq("id", statusId)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!target) throw new Error(i18n.t("settings.statuses.errors.notFound"));
  if ((target as { entity?: string }).entity !== "order") {
    throw new Error(i18n.t("settings.statuses.errors.orderOnly"));
  }
  if ((target as { is_active?: boolean }).is_active === false) {
    throw new Error(i18n.t("settings.statuses.errors.inactiveDefault"));
  }
  if ((target as { semantic_action?: string }).semantic_action === "close" || (target as { semantic_action?: string }).semantic_action === "cancel") {
    throw new Error(i18n.t("settings.statuses.errors.protectedDefault"));
  }

  const { error: clearError } = await supabase
    .from("status_definitions")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("workspace_id", resolved)
    .eq("entity", "order")
    .is("deleted_at", null)
    .eq("is_default", true);
  if (clearError) throw new Error(clearError.message);

  const { data, error } = await supabase
    .from("status_definitions")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", statusId)
    .eq("workspace_id", resolved)
    .select(statusColumns)
    .maybeSingle();
  if (error) {
    if (isMissingLifecycleColumn(error)) {
      const legacy = await supabase
        .from("status_definitions")
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq("id", statusId)
        .eq("workspace_id", resolved)
        .select(statusColumnsLegacy)
        .maybeSingle();
      if (legacy.error) throw new Error(legacy.error.message);
      if (!legacy.data) throw new Error(i18n.t("settings.statuses.errors.notFound"));
      return toStatusDefinition(legacy.data as Record<string, unknown>);
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error(i18n.t("settings.statuses.errors.notFound"));
  return toStatusDefinition(data as Record<string, unknown>);
}

/** Reorders statuses by writing sequential sort_order values. */
export async function reorderStatusDefinitions(orderedIds: string[], workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const ids = orderedIds.map((id) => id.trim()).filter(Boolean);
  for (let index = 0; index < ids.length; index += 1) {
    const { error } = await supabase
      .from("status_definitions")
      .update({ sort_order: index + 1, updated_at: new Date().toISOString() })
      .eq("id", ids[index])
      .eq("workspace_id", resolved)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
  }
}

/** Soft-deletes an unused status. Fails if orders still reference it. */
export async function deleteStatusDefinition(statusId: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);

  const { count, error: countError } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", resolved)
    .eq("custom_status_id", statusId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) throw new Error(i18n.t("settings.statuses.errors.inUse"));

  const { data: row, error: loadError } = await supabase
    .from("status_definitions")
    .select("id, is_default, semantic_action")
    .eq("id", statusId)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!row) throw new Error(i18n.t("settings.statuses.errors.notFound"));
  if ((row as { is_default?: boolean }).is_default) {
    throw new Error(i18n.t("settings.statuses.errors.cannotDeleteDefault"));
  }
  const action = (row as { semantic_action?: string }).semantic_action;
  if (action === "close" || action === "cancel") {
    throw new Error(i18n.t("settings.statuses.errors.cannotDeleteProtected"));
  }

  const { error } = await supabase
    .from("status_definitions")
    .update({ deleted_at: new Date().toISOString(), is_active: false, is_default: false, updated_at: new Date().toISOString() })
    .eq("id", statusId)
    .eq("workspace_id", resolved);
  if (error) throw new Error(error.message);
}

export async function setOrderLifecycleSemantic(
  statusId: string,
  action: StatusSemanticAction,
  workspaceId: string | undefined,
) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.rpc("set_order_lifecycle_semantic", {
    p_workspace_id: resolved,
    p_status_id: statusId,
    p_action: action,
  });
  if (error) {
    if (isMissingRpcError(error, "set_order_lifecycle_semantic")) {
      throw new MissingRpcError("set_order_lifecycle_semantic", i18n.t("settings.statuses.errors.lifecycleRpcRequired"));
    }
    throw new Error(mapLifecycleDbError(error.message));
  }
  return data;
}

export async function replaceOrderStatus(fromStatusId: string, toStatusId: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.rpc("replace_order_status", {
    p_workspace_id: resolved,
    p_from_status_id: fromStatusId,
    p_to_status_id: toStatusId,
  });
  if (error) {
    if (isMissingRpcError(error, "replace_order_status")) {
      throw new MissingRpcError("replace_order_status", i18n.t("settings.statuses.errors.lifecycleRpcRequired"));
    }
    throw new Error(mapLifecycleDbError(error.message));
  }
  return data;
}

export function isProtectedSemantic(action: StatusSemanticAction | string | null | undefined) {
  return action === "close" || action === "cancel";
}

export function normalActiveOrderStatuses(definitions: readonly StatusDefinition[]) {
  return definitions.filter((d) => d.entity === "order" && d.isActive && d.semanticAction === "normal");
}

function mapLifecycleDbError(message: string) {
  if (/forbidden/i.test(message)) return i18n.t("settings.statuses.errors.forbidden");
  if (/status_not_found/i.test(message)) return i18n.t("settings.statuses.errors.notFound");
  if (/replace_target_protected/i.test(message)) return i18n.t("settings.statuses.errors.replaceTargetProtected");
  if (/replace_source_has_semantic/i.test(message)) return i18n.t("settings.statuses.errors.replaceSourceProtected");
  if (/replace_target|replace_same/i.test(message)) return i18n.t("settings.statuses.errors.replaceTargetInvalid");
  if (/23505|duplicate/i.test(message)) return i18n.t("settings.statuses.errors.duplicateSemantic");
  return message;
}
