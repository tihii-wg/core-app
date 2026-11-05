import type { ClosedOrderPermissionGrants } from "../../services/apiClosedOrderPermissions";
import {
  CLOSED_ORDER_PERMISSIONS,
  roleHasClosedOrderPermission,
} from "../../services/apiClosedOrderPermissions";
import { isOrderFormallyClosed } from "./orderLifecycle";
import type { Order } from "../../lib/types";

/**
 * Owner-only override for managing formally closed orders.
 *
 * BOTH required:
 * 1. `workspaces.owner_id === auth.uid()` (isOwnerByOwnerId — never membership role alone)
 * 2. `workspaces.owner_can_manage_closed_orders === true`
 *
 * Never true for admin/manager/member, or a membership role of "owner" without owner_id.
 * View access to closed orders (including saved warranty) is independent of this flag.
 */
export function ownerMayManageClosedOrders(opts: {
  isOwnerByOwnerId: boolean;
  ownerCanManageClosedOrders: boolean;
}): boolean {
  return Boolean(opts.isOwnerByOwnerId && opts.ownerCanManageClosedOrders);
}

/**
 * True when the order is open, or the caller may manage this closed/cancelled order.
 *
 * Cancelled orders (including closed-then-cancelled with preserved `closed_at`):
 * workspace `owner_id` may edit contents without `owner_can_manage_closed_orders`.
 * That setting remains required for ordinary closed (`status === "closed"`) orders.
 */
export function canMutateOrderContent(opts: {
  order: Pick<Order, "closedAt" | "status">;
  isOwnerByOwnerId: boolean;
  ownerCanManageClosedOrders: boolean;
}): boolean {
  if (!isOrderFormallyClosed(opts.order)) return true;
  if (opts.order.status === "cancelled" && opts.isOwnerByOwnerId) return true;
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
  /** Owner + workspaces.owner_can_manage_closed_orders (required for owner cancel of closed). */
  ownerCanManageClosedOrders?: boolean;
}): boolean {
  if (!opts.canWrite) return false;
  if (opts.order.status === "cancelled") return false;
  if (isOrderFormallyClosed(opts.order)) {
    return (
      ownerMayManageClosedOrders({
        isOwnerByOwnerId: Boolean(opts.isOwnerByOwnerId),
        ownerCanManageClosedOrders: Boolean(opts.ownerCanManageClosedOrders),
      }) || canCancelClosedOrder(opts.workspaceRole, opts.grants)
    );
  }
  return true;
}

/**
 * Closed orders still require cancel-before-delete.
 * After cancel, deletion of a closed order needs owner-manage setting or orders.delete_closed.
 */
export function canOfferDeleteClosedOrderAction(opts: {
  order: Pick<Order, "closedAt" | "status">;
  workspaceRole: string | null | undefined;
  grants: ClosedOrderPermissionGrants | null | undefined;
  isOwnerByOwnerId?: boolean;
  ownerCanManageClosedOrders?: boolean;
}): boolean {
  if (!isOrderFormallyClosed(opts.order)) return true;
  return (
    ownerMayManageClosedOrders({
      isOwnerByOwnerId: Boolean(opts.isOwnerByOwnerId),
      ownerCanManageClosedOrders: Boolean(opts.ownerCanManageClosedOrders),
    }) || canDeleteClosedOrder(opts.workspaceRole, opts.grants)
  );
}
