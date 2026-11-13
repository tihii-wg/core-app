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

/** True when the membership role has orders.closed_full_access in this workspace. */
export function hasClosedOrderFullAccess(
  workspaceRole: string | null | undefined,
  grants: ClosedOrderPermissionGrants | null | undefined,
): boolean {
  return roleHasClosedOrderPermission(
    workspaceRole,
    CLOSED_ORDER_PERMISSIONS.closedFullAccess,
    grants,
  );
}

/**
 * Owner_id OR role with orders.closed_full_access — equal to owner for
 * closed/cancelled order lifecycle only (not workspace settings / billing / etc.).
 */
export function actsAsOwnerForClosedOrders(opts: {
  isOwnerByOwnerId: boolean;
  workspaceRole?: string | null;
  grants?: ClosedOrderPermissionGrants | null;
}): boolean {
  if (opts.isOwnerByOwnerId) return true;
  return hasClosedOrderFullAccess(opts.workspaceRole, opts.grants);
}

/**
 * True when the order is open, or cancelled and the caller acts as owner for closed orders.
 * Formally closed (non-cancelled) orders are immutable for everyone — cancel first.
 * `ownerCanManageClosedOrders` only gates cancel/delete, not content mutation.
 */
export function canMutateOrderContent(opts: {
  order: Pick<Order, "closedAt" | "status">;
  isOwnerByOwnerId: boolean;
  ownerCanManageClosedOrders?: boolean;
  workspaceRole?: string | null;
  grants?: ClosedOrderPermissionGrants | null;
}): boolean {
  if (!isOrderFormallyClosed(opts.order)) return true;
  if (
    opts.order.status === "cancelled" &&
    actsAsOwnerForClosedOrders({
      isOwnerByOwnerId: opts.isOwnerByOwnerId,
      workspaceRole: opts.workspaceRole,
      grants: opts.grants,
    })
  ) {
    return true;
  }
  return false;
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
      }) ||
      hasClosedOrderFullAccess(opts.workspaceRole, opts.grants) ||
      canCancelClosedOrder(opts.workspaceRole, opts.grants)
    );
  }
  return true;
}

/**
 * Closed orders still require cancel-before-delete.
 * After cancel, deletion of a closed order needs owner-manage setting, full access, or orders.delete_closed.
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
    }) ||
    hasClosedOrderFullAccess(opts.workspaceRole, opts.grants) ||
    canDeleteClosedOrder(opts.workspaceRole, opts.grants)
  );
}
