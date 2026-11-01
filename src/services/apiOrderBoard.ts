import i18n from "../i18n";
import type { OrderStatus } from "../lib/types";
import { recordActivity } from "./apiActivityLog";
import { recordStatusChangeEvents } from "./apiOrderEvents";
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
 * Step 1 reuses `updateOrderStatus` (paid lock + tax-invoice gate stay enforced
 * server-side by the app layer). Step 2 stores `orders.custom_status_id`
 * (null for system columns). Requires the `custom_status_id` column from
 * `20261031000000_orders_custom_status.PRODUCTION.sql`.
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
  }

  const fromCustomStatusId = await getCurrentCustomStatusId(orderId, resolved);
  if (fromCustomStatusId) {
    await assertCustomStatusTransition(resolved, fromCustomStatusId, customStatusId);
  }

  if (status !== currentStatus) {
    await updateOrderStatus(orderId, status, resolved, { recordActivity: false });
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ custom_status_id: customStatusId })
    .eq("id", orderId)
    .eq("workspace_id", resolved)
    .select("id");

  if (error) {
    if (isMissingCustomStatusColumn(error)) {
      throw new Error(i18n.t("orders.board.errors.customStatusUnavailable"));
    }
    throw new Error(error.message);
  }
  if (!data || data.length === 0) throw new Error(i18n.t("orders.board.errors.moveFailed"));

  if (status !== currentStatus || fromCustomStatusId !== customStatusId) {
    await recordActivity({
      workspaceId: resolved,
      entityType: "order",
      entityId: orderId,
      event: "order.status_changed",
      details: {
        source: "board",
        from: currentStatus,
        to: status,
        fromCustomStatusId,
        toCustomStatusId: customStatusId,
      },
    });

    // Feed entries keep the custom status names so they stay readable after a rename or delete.
    const names = await getStatusDefinitionsByIds(
      resolved,
      [fromCustomStatusId, customStatusId].filter((id): id is string => Boolean(id)),
    ).catch(() => new Map<string, { name: string }>());
    await recordStatusChangeEvents({
      orderId,
      source: "board",
      from: currentStatus,
      to: status,
      fromCustomStatusId,
      toCustomStatusId: customStatusId,
      fromCustomStatusName: fromCustomStatusId ? names.get(fromCustomStatusId)?.name ?? null : null,
      toCustomStatusName: customStatusId ? names.get(customStatusId)?.name ?? null : null,
    });
  }
}
