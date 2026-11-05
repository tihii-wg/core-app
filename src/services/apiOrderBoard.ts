import i18n from "../i18n";
import type { OrderStatus } from "../lib/types";
import { updateOrderStatus } from "./apiOrders";
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

/** Reads the order's current custom status. Missing column (migration not applied) degrades to null. */
async function getCurrentCustomStatusId(orderId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("custom_status_id")
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    if (isMissingCustomStatusColumn(error)) return null;
    throw new Error(error.message);
  }
  const value = (data as { custom_status_id?: unknown } | null)?.custom_status_id;
  return typeof value === "string" && value ? value : null;
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
) {
  const resolved = requireWorkspaceId(workspaceId);

  if (customStatusId) {
    const found = await getStatusDefinitionsByIds(resolved, [customStatusId]);
    const definition = found.get(customStatusId);
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

  // Closed/cancelled are lifecycle-only — ordinary board moves must not reopen or re-annotate them.
  if (status === "closed" || status === "cancelled") {
    throw new Error(
      status === "cancelled"
        ? i18n.t("orders.lifecycle.errors.useCancelAction")
        : i18n.t("orders.lifecycle.errors.useCloseAction"),
    );
  }

  const fromCustomStatusId = await getCurrentCustomStatusId(orderId, resolved);

  // Open-order path must not run against a formally closed or cancelled row.
  const { data: existing, error: existingError } = await supabase
    .from("orders")
    .select("status, closed_at")
    .eq("id", orderId)
    .eq("workspace_id", resolved)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error(i18n.t("orders.board.errors.moveFailed"));
  const existingStatus =
    typeof (existing as { status?: unknown }).status === "string" ? (existing as { status: string }).status : "";
  if ((existing as { closed_at?: unknown }).closed_at || existingStatus === "closed") {
    throw new Error(i18n.t("orders.lifecycle.errors.orderAlreadyClosed"));
  }
  if (existingStatus === "cancelled") {
    throw new Error(i18n.t("orders.lifecycle.errors.orderAlreadyCancelled"));
  }

  if (fromCustomStatusId) {
    await assertCustomStatusTransition(resolved, fromCustomStatusId, customStatusId);
  }

  // No-op: already on this column — do not write activity or touch the row.
  if (status === currentStatus && fromCustomStatusId === customStatusId) {
    return {
      status,
      customStatusId,
      customStatus: null as { name: string; color: string | null } | null,
    };
  }

  // Single UPDATE for system + custom status. Feed history comes from the DB trigger only.
  // Activity log (reports) is still written once by updateOrderStatus.
  return updateOrderStatus(orderId, status, resolved, {
    customStatusId,
    recordActivity: true,
  });
}
