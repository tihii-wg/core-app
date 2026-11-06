import i18n from "../i18n";
import type { OrderStatus } from "../lib/types";
import { updateOrderStatus, type UpdateOrderStatusResult } from "./apiOrders";
import { assertCustomStatusTransition, getStatusDefinitionsByIds } from "./apiStatusDefinitions";
import supabase from "./supabase";

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

function isMissingCustomStatusColumn(error: { code?: string; message?: string }) {
  return error.code === "42703" || error.code === "PGRST204" || /custom_status_id/i.test(error.message ?? "");
}

/**
 * Moves an order to a board column.
 *
 * Uses a single `updateOrderStatus` write (system status + exact column custom id) so the
 * DB trigger `crm_orders_status_event` records exactly one feed event. Does not dual-write
 * via `crm_record_order_event`.
 *
 * Custom -> custom/system moves are checked against `status_transitions` first
 * (degrades to allowed when the table or rows are absent).
 */
export async function moveOrderOnBoard(
  { orderId, status, customStatusId, currentStatus }: { orderId: string; status: OrderStatus; customStatusId: string | null; currentStatus: OrderStatus },
  workspaceId: string | undefined,
): Promise<UpdateOrderStatusResult> {
  const resolved = requireWorkspaceId(workspaceId);

  // Closed/cancelled are lifecycle-only — ordinary board moves must not reopen or re-annotate them.
  if (status === "closed" || status === "cancelled") {
    throw new Error(
      status === "cancelled"
        ? i18n.t("orders.lifecycle.errors.useCancelAction")
        : i18n.t("orders.lifecycle.errors.useCloseAction"),
    );
  }

  const definitionIds = customStatusId ? [customStatusId] : [];

  const [orderResult, definitionsById] = await Promise.all([
    supabase
      .from("orders")
      .select("status, closed_at, custom_status_id")
      .eq("id", orderId)
      .eq("workspace_id", resolved)
      .maybeSingle(),
    definitionIds.length > 0
      ? getStatusDefinitionsByIds(resolved, definitionIds)
      : Promise.resolve(new Map()),
  ]);

  if (orderResult.error) {
    if (isMissingCustomStatusColumn(orderResult.error)) {
      // Retry without custom_status_id for older schemas.
      const legacy = await supabase
        .from("orders")
        .select("status, closed_at")
        .eq("id", orderId)
        .eq("workspace_id", resolved)
        .maybeSingle();
      if (legacy.error) throw new Error(legacy.error.message);
      if (!legacy.data) throw new Error(i18n.t("orders.board.errors.moveFailed"));
      const legacyStatus =
        typeof (legacy.data as { status?: unknown }).status === "string"
          ? (legacy.data as { status: string }).status
          : "";
      const legacyClosedAt =
        typeof (legacy.data as { closed_at?: unknown }).closed_at === "string"
          ? (legacy.data as { closed_at: string }).closed_at
          : null;
      return updateOrderStatus(orderId, status, resolved, {
        customStatusId,
        recordActivity: true,
        preloaded: { status: legacyStatus, closedAt: legacyClosedAt, customStatusId: null },
      });
    }
    throw new Error(orderResult.error.message);
  }
  if (!orderResult.data) throw new Error(i18n.t("orders.board.errors.moveFailed"));

  const existingStatus =
    typeof (orderResult.data as { status?: unknown }).status === "string"
      ? (orderResult.data as { status: string }).status
      : "";
  const existingClosedAt =
    typeof (orderResult.data as { closed_at?: unknown }).closed_at === "string"
      ? (orderResult.data as { closed_at: string }).closed_at
      : null;
  const fromCustomStatusId =
    typeof (orderResult.data as { custom_status_id?: unknown }).custom_status_id === "string"
      ? String((orderResult.data as { custom_status_id: string }).custom_status_id).trim() || null
      : null;

  if (customStatusId) {
    const definition = definitionsById.get(customStatusId);
    if (!definition || definition.entity !== "order") {
      throw new Error(i18n.t("orders.board.errors.unknownStatus"));
    }
    if (definition.semanticAction === "close") {
      throw new Error(i18n.t("orders.lifecycle.errors.useCloseAction"));
    }
    if (definition.semanticAction === "cancel") {
      throw new Error(i18n.t("orders.lifecycle.errors.useCancelAction"));
    }
    if (definition.systemStatus === "closed" || definition.systemStatus === "cancelled") {
      throw new Error(i18n.t("orders.lifecycle.errors.useCloseAction"));
    }
  }

  if (fromCustomStatusId && existingStatus !== "cancelled") {
    await assertCustomStatusTransition(resolved, fromCustomStatusId, customStatusId);
  }

  // No-op: already on this column — do not write activity or touch the row.
  if (status === currentStatus && fromCustomStatusId === customStatusId) {
    const keep = customStatusId ? definitionsById.get(customStatusId) : null;
    return {
      status,
      customStatusId,
      customStatus: keep ? { name: keep.name, color: keep.color } : null,
    };
  }

  // Single UPDATE for system + custom status. Feed history comes from the DB trigger only.
  // Activity log (reports) is still written once by updateOrderStatus.
  return updateOrderStatus(orderId, status, resolved, {
    customStatusId,
    recordActivity: true,
    preloaded: {
      status: existingStatus,
      closedAt: existingClosedAt,
      customStatusId: fromCustomStatusId,
    },
  });
}
