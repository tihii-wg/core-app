import type { ClosedOrderPermissionGrants } from "../../services/apiClosedOrderPermissions";
import {
  CLOSED_ORDER_PERMISSIONS,
  roleHasClosedOrderPermission,
} from "../../services/apiClosedOrderPermissions";
import { isOrderFormallyClosed } from "./orderLifecycle";
import type { Order } from "../../lib/types";

export function canCancelClosedOrder(
  workspaceRole: string | null | undefined,
  grants: ClosedOrderPermissionGrants | null | undefined,
): boolean {
  return roleHasClosedOrderPermission(workspaceRole, CLOSED_ORDER_PERMISSIONS.cancelClosed, grants);
}

export function canDeleteClosedOrder(
  workspaceRole: string | null | undefined,
  grants: ClosedOrderPermissionGrants | null | undefined,
): boolean {
  return roleHasClosedOrderPermission(workspaceRole, CLOSED_ORDER_PERMISSIONS.deleteClosed, grants);
}

/** Whether the Cancel action should be offered for this order. */
export function canOfferCancelOrderAction(opts: {
  order: Pick<Order, "closedAt" | "status">;
  canWrite: boolean;
  workspaceRole: string | null | undefined;
  grants: ClosedOrderPermissionGrants | null | undefined;
}): boolean {
  if (!opts.canWrite) return false;
  if (opts.order.status === "cancelled") return false;
  if (isOrderFormallyClosed(opts.order)) {
    return canCancelClosedOrder(opts.workspaceRole, opts.grants);
  }
  return true;
}

/**
 * Closed orders still require cancel-before-delete.
 * After cancel, deletion of a closed order needs orders.delete_closed (owner always).
 */
export function canOfferDeleteClosedOrderAction(opts: {
  order: Pick<Order, "closedAt" | "status">;
  workspaceRole: string | null | undefined;
  grants: ClosedOrderPermissionGrants | null | undefined;
}): boolean {
  if (!isOrderFormallyClosed(opts.order)) return true;
  return canDeleteClosedOrder(opts.workspaceRole, opts.grants);
}
