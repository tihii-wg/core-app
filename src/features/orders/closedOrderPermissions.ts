import type { ClosedOrderPermissionGrants } from "../../services/apiClosedOrderPermissions";
import {
  CLOSED_ORDER_PERMISSIONS,
  roleHasClosedOrderPermission,
} from "../../services/apiClosedOrderPermissions";
import { isOrderFormallyClosed } from "./orderLifecycle";
import type { Order } from "../../lib/types";

/**
 * Owner-only override for managing formally closed orders.
 * Requires authoritative `workspaces.owner_id` match AND the workspace setting.
 * Never true for admin/manager/member.
 */
export function ownerMayManageClosedOrders(opts: {
  isOwnerByOwnerId: boolean;
  ownerCanManageClosedOrders: boolean;
}): boolean {
  return Boolean(opts.isOwnerByOwnerId && opts.ownerCanManageClosedOrders);
}

/** True when the order is open, or the caller may manage this closed order. */
export function canMutateOrderContent(opts: {
  order: Pick<Order, "closedAt" | "status">;
  isOwnerByOwnerId: boolean;
  ownerCanManageClosedOrders: boolean;
}): boolean {
  if (!isOrderFormallyClosed(opts.order)) return true;
  return ownerMayManageClosedOrders(opts);
}

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
  /** Authoritative `workspaces.owner_id === auth user` (preferred over membership role). */
  isOwnerByOwnerId?: boolean;
}): boolean {
  if (!opts.canWrite) return false;
  if (opts.order.status === "cancelled") return false;
  if (isOrderFormallyClosed(opts.order)) {
    return Boolean(opts.isOwnerByOwnerId) || canCancelClosedOrder(opts.workspaceRole, opts.grants);
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
  isOwnerByOwnerId?: boolean;
}): boolean {
  if (!isOrderFormallyClosed(opts.order)) return true;
  return Boolean(opts.isOwnerByOwnerId) || canDeleteClosedOrder(opts.workspaceRole, opts.grants);
}
