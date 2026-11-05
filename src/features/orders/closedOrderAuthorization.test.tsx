import { describe, expect, it } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { screen } from "@testing-library/react";
import {
  canMutateOrderContent,
  canOfferCancelOrderAction,
  canOfferDeleteClosedOrderAction,
  ownerMayManageClosedOrders,
} from "./closedOrderPermissions";
import { OrderLineWarrantyBadge } from "./OrderLineWarrantyBadge";

/**
 * Mandatory closed-order override rule:
 * editing requires workspaces.owner_id = auth.uid() AND owner_can_manage_closed_orders = true.
 * Membership role "owner" alone is never sufficient. View access (warranty display) stays open.
 */
describe("closed-order owner override authorization", () => {
  const closed = { status: "closed" as const, closedAt: "2026-11-01T00:00:00.000Z" };
  const emptyGrants = { cancelClosed: [] as const, deleteClosed: [] as const };

  it("actual owner + setting ON: editing allowed", () => {
    expect(ownerMayManageClosedOrders({ isOwnerByOwnerId: true, ownerCanManageClosedOrders: true })).toBe(true);
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(true);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "owner",
        grants: emptyGrants,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(true);
    expect(
      canOfferDeleteClosedOrderAction({
        order: { status: "cancelled", closedAt: closed.closedAt },
        workspaceRole: "owner",
        grants: emptyGrants,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(true);
  });

  it("actual owner + setting OFF: editing denied", () => {
    expect(ownerMayManageClosedOrders({ isOwnerByOwnerId: true, ownerCanManageClosedOrders: false })).toBe(false);
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(false);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "owner",
        grants: emptyGrants,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(false);
    expect(
      canOfferDeleteClosedOrderAction({
        order: { status: "cancelled", closedAt: closed.closedAt },
        workspaceRole: "owner",
        grants: emptyGrants,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(false);
  });

  it("admin + setting ON: editing denied", () => {
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "admin",
        grants: emptyGrants,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
  });

  it("manager + setting ON: editing denied", () => {
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "manager",
        grants: emptyGrants,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
  });

  it("member + setting ON: editing denied", () => {
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "member",
        grants: emptyGrants,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
  });

  it("membership role owner without owner_id never receives the override", () => {
    // Role string "owner" without authoritative owner_id match must stay read-only.
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "owner",
        grants: emptyGrants,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
    expect(
      canOfferDeleteClosedOrderAction({
        order: { status: "cancelled", closedAt: closed.closedAt },
        workspaceRole: "owner",
        grants: emptyGrants,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
  });

  it("open orders keep normal mutation permission regardless of the setting", () => {
    expect(
      canMutateOrderContent({
        order: { status: "in-progress", closedAt: null },
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(true);
  });

  it("read-only users still see saved warranty information on closed orders", () => {
    // Warranty badges are display-only — not gated by canMutateOrderContent / closedContentLocked.
    renderWithQuery(
      <OrderLineWarrantyBadge
        activated
        limits={{ durationMonths: 12, mileageLimit: 20000 }}
      />,
    );
    expect(screen.getByText(/Warranty: 12 months \/ 20,000 km/)).toBeInTheDocument();
    expect(screen.getByText(/Warranty: 12 months \/ 20,000 km/).closest("[data-warranty-line]")).toHaveAttribute(
      "data-warranty-activated",
      "true",
    );
  });
});
