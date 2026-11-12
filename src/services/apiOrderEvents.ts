import {
  isMeaningfulOrderEventType,
  MEANINGFUL_ORDER_EVENT_TYPES,
  RECENT_ORDERS_LIMIT,
  uniqueOrderIdsByLatestActivity,
} from "../features/dashboard/recentOrdersByActivity";
import supabase from "./supabase";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";

/**
 * Order feed events (`order_events`, crm_ro_v1).
 *
 * RLS: read '*' for members, write '-' (nobody from the browser). Rows are written only by the
 * SECURITY DEFINER RPC `crm_record_order_event` and the optional trigger from
 * `supabase/manual/20261101040000_order_events_rpc.PRODUCTION.sql`.
 */

export type OrderEvent = {
  id: string;
  orderId: string;
  eventType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  payload: Record<string, unknown>;
  actorName: string | null;
  /** auth user id of the actor (resolves the display name; `actorName` may hold an email). */
  actorUserId: string | null;
  createdAt: string;
};

export type OrderEventsResult = {
  events: OrderEvent[];
  /** True when `order_events` is not applied in this database yet (crm_ro_v1.PRODUCTION.sql). */
  isUnavailable: boolean;
};

const orderEventColumns = "id, order_id, event_type, field_name, old_value, new_value, payload, actor_name, actor_user_id, created_at";
export const ORDER_EVENTS_LIMIT = 100;

const text = (value: unknown) => (typeof value === "string" ? value : null);

export function toOrderEvent(row: Record<string, unknown>): OrderEvent {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
  const actor = text(row.actor_name)?.trim();
  return {
    id: String(row.id),
    orderId: text(row.order_id) ?? "",
    eventType: text(row.event_type) ?? "",
    fieldName: text(row.field_name),
    oldValue: text(row.old_value),
    newValue: text(row.new_value),
    payload,
    actorName: actor || null,
    actorUserId: text(row.actor_user_id),
    createdAt: text(row.created_at) ?? "",
  };
}

/** Newest first, ties broken by id so the order is stable. Pure. */
export function sortOrderEvents(events: readonly OrderEvent[]) {
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export async function getOrderEvents(workspaceId: string | undefined, orderId: string, limit = ORDER_EVENTS_LIMIT): Promise<OrderEventsResult> {
  const resolved = requireWorkspaceId(workspaceId);
  if (!orderId.trim()) return { events: [], isUnavailable: false };

  const { data, error } = await supabase
    .from("order_events")
    .select(orderEventColumns)
    .eq("workspace_id", resolved)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error, "order_events")) return { events: [], isUnavailable: true };
    throw new Error(error.message);
  }
  return { events: sortOrderEvents(((data ?? []) as Record<string, unknown>[]).map(toOrderEvent)), isUnavailable: false };
}

export type RecentActiveOrderIdsResult = {
  orderIds: string[];
  /** True when `order_events` (or the optional recent-ids RPC) is not available — callers should fall back. */
  isUnavailable: boolean;
};

const RECENT_ACTIVITY_SCAN_PAGE = 100;
const RECENT_ACTIVITY_SCAN_MAX_PAGES = 5;

/**
 * Workspace-scoped order ids ordered by latest meaningful `order_events` activity (newest first).
 * Prefers `crm_recent_active_order_ids` when applied; otherwise scans newest events until `limit`
 * unique orders are collected (does not load the full event history).
 */
export async function getRecentActiveOrderIds(
  workspaceId: string | undefined,
  limit = RECENT_ORDERS_LIMIT,
): Promise<RecentActiveOrderIdsResult> {
  const resolved = requireWorkspaceId(workspaceId);
  const capped = Math.max(0, Math.min(50, Math.floor(limit) || RECENT_ORDERS_LIMIT));
  if (capped === 0) return { orderIds: [], isUnavailable: false };

  const fromRpc = await tryRecentActiveOrderIdsRpc(resolved, capped);
  if (fromRpc) return fromRpc;

  return scanRecentActiveOrderIds(resolved, capped);
}

async function tryRecentActiveOrderIdsRpc(
  workspaceId: string,
  limit: number,
): Promise<RecentActiveOrderIdsResult | null> {
  try {
    const { data, error } = await supabase.rpc("crm_recent_active_order_ids", {
      p_workspace_id: workspaceId,
      p_limit: limit,
    });
    if (error) {
      if (isMissingOrderEventRpc(error) || isMissingTableError(error, "order_events")) return null;
      // Permission / unexpected RPC errors: fall through to the table scan.
      return null;
    }
    const orderIds: string[] = [];
    const seen = new Set<string>();
    for (const row of (data ?? []) as { order_id?: unknown }[]) {
      const id = typeof row.order_id === "string" ? row.order_id.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      orderIds.push(id);
      if (orderIds.length >= limit) break;
    }
    return { orderIds, isUnavailable: false };
  } catch {
    return null;
  }
}

async function scanRecentActiveOrderIds(workspaceId: string, limit: number): Promise<RecentActiveOrderIdsResult> {
  const collected: { orderId: string; eventType: string; createdAt: string }[] = [];
  let offset = 0;

  for (let page = 0; page < RECENT_ACTIVITY_SCAN_MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("order_events")
      .select("order_id, event_type, created_at")
      .eq("workspace_id", workspaceId)
      .in("event_type", [...MEANINGFUL_ORDER_EVENT_TYPES])
      .order("created_at", { ascending: false })
      .range(offset, offset + RECENT_ACTIVITY_SCAN_PAGE - 1);

    if (error) {
      if (isMissingTableError(error, "order_events")) return { orderIds: [], isUnavailable: true };
      throw new Error(error.message);
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const orderId = text(row.order_id) ?? "";
      const eventType = text(row.event_type) ?? "";
      const createdAt = text(row.created_at) ?? "";
      if (!orderId || !isMeaningfulOrderEventType(eventType)) continue;
      collected.push({ orderId, eventType, createdAt });
    }

    const uniqueSoFar = uniqueOrderIdsByLatestActivity(collected, limit);
    if (uniqueSoFar.length >= limit || rows.length < RECENT_ACTIVITY_SCAN_PAGE) {
      return { orderIds: uniqueSoFar, isUnavailable: false };
    }
    offset += RECENT_ACTIVITY_SCAN_PAGE;
  }

  return { orderIds: uniqueOrderIdsByLatestActivity(collected, limit), isUnavailable: false };
}

export type RecordOrderEventInput = {
  orderId: string;
  eventType: string;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  payload?: Record<string, unknown>;
};

export type RecordOrderEventResult = {
  recorded: boolean;
  /** Why nothing was written; absent when recorded. */
  reason?: "rpc-missing" | "denied" | "error";
};

type RpcError = { code?: string; message?: string; details?: string | null } | null | undefined;

/** The RPC does not exist on the connected database (PostgREST PGRST202 / Postgres 42883). */
export function isMissingOrderEventRpc(error: RpcError) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|function .* does not exist/i.test(`${error.message ?? ""} ${error.details ?? ""}`);
}

// Remember a missing RPC for the page lifetime so every status move does not fire a doomed request.
let rpcKnownMissing = false;

/** Test hook: forget the cached "RPC missing" state. */
export function resetOrderEventRpcState() {
  rpcKnownMissing = false;
}

/**
 * Best-effort feed write through `crm_record_order_event`. Never throws: a missing RPC (SQL not applied),
 * a permission denial or any other failure resolves to `{ recorded: false }` so the primary mutation is unaffected.
 */
export async function recordOrderEvent(input: RecordOrderEventInput): Promise<RecordOrderEventResult> {
  try {
    if (!input.orderId.trim() || !input.eventType.trim()) return { recorded: false, reason: "error" };
    if (rpcKnownMissing) return { recorded: false, reason: "rpc-missing" };

    const { error } = await supabase.rpc("crm_record_order_event", {
      p_order_id: input.orderId,
      p_event_type: input.eventType,
      p_field_name: input.fieldName ?? null,
      p_old_value: input.oldValue ?? null,
      p_new_value: input.newValue ?? null,
      p_payload: input.payload ?? {},
    });

    if (error) {
      if (isMissingOrderEventRpc(error)) {
        rpcKnownMissing = true;
        return { recorded: false, reason: "rpc-missing" };
      }
      if (error.code === "42501") return { recorded: false, reason: "denied" };
      return { recorded: false, reason: "error" };
    }
    return { recorded: true };
  } catch {
    return { recorded: false, reason: "error" };
  }
}

/**
 * Inputs for a logical status transition.
 *
 * Emits at most ONE `status_changed` event so the order feed never shows duplicate
 * "Status changed" lines for the same user action. When a custom status changes,
 * prefer that row (includes display names); otherwise record the system status change.
 *
 * Prefer the DB trigger `crm_orders_status_event` as the canonical writer. App-layer
 * callers should not also insert when that trigger is applied.
 */
export function buildStatusEventInputs(change: {
  orderId: string;
  source: string;
  from: string | null;
  to: string | null;
  fromCustomStatusId?: string | null;
  toCustomStatusId?: string | null;
  fromCustomStatusName?: string | null;
  toCustomStatusName?: string | null;
}): RecordOrderEventInput[] {
  const statusChanged = (change.from ?? null) !== (change.to ?? null);
  const customChanged = (change.fromCustomStatusId ?? null) !== (change.toCustomStatusId ?? null);

  if (customChanged) {
    return [
      {
        orderId: change.orderId,
        eventType: "status_changed",
        fieldName: "custom_status_id",
        oldValue: change.fromCustomStatusId ?? null,
        newValue: change.toCustomStatusId ?? null,
        payload: {
          source: change.source,
          ...(change.fromCustomStatusName ? { old_name: change.fromCustomStatusName } : {}),
          ...(change.toCustomStatusName ? { new_name: change.toCustomStatusName } : {}),
          ...(statusChanged ? { system_from: change.from, system_to: change.to } : {}),
        },
      },
    ];
  }

  if (statusChanged) {
    return [
      {
        orderId: change.orderId,
        eventType: "status_changed",
        fieldName: "status",
        oldValue: change.from,
        newValue: change.to,
        payload: { source: change.source },
      },
    ];
  }

  return [];
}

/** Records every event of a status change (sequentially, so ordering in the feed is deterministic). Never throws. */
export async function recordStatusChangeEvents(change: Parameters<typeof buildStatusEventInputs>[0]) {
  for (const input of buildStatusEventInputs(change)) {
    await recordOrderEvent(input);
  }
}
