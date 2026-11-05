import { describe, expect, it } from "vitest";
import {
  canCancelClosedOrder,
  canDeleteClosedOrder,
  canMutateOrderContent,
  canOfferCancelOrderAction,
  canOfferDeleteClosedOrderAction,
  ownerMayManageClosedOrders,
} from "./closedOrderPermissions";

describe("closed order UI permission helpers", () => {
  it("owner without manage setting cannot cancel or delete closed orders", () => {
    const empty = { cancelClosed: [], deleteClosed: [] };
    const closed = { status: "closed" as const, closedAt: "2026-01-01T00:00:00.000Z" };
    expect(canCancelClosedOrder("owner", empty)).toBe(false);
    expect(canDeleteClosedOrder("owner", empty)).toBe(false);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "owner",
        grants: empty,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(false);
    expect(
      canOfferDeleteClosedOrderAction({
        order: { status: "cancelled", closedAt: "2026-01-01T00:00:00.000Z" },
        workspaceRole: "owner",
        grants: empty,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(false);
  });

  it("owner with manage setting can cancel and delete closed orders", () => {
    const empty = { cancelClosed: [], deleteClosed: [] };
    const closed = { status: "closed" as const, closedAt: "2026-01-01T00:00:00.000Z" };
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "owner",
        grants: empty,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(true);
    expect(
      canOfferDeleteClosedOrderAction({
        order: { status: "cancelled", closedAt: "2026-01-01T00:00:00.000Z" },
        workspaceRole: "owner",
        grants: empty,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(true);
  });

  it("admin can cancel but not delete when only cancellation is granted", () => {
    const grants = { cancelClosed: ["admin"] as const, deleteClosed: [] as const };
    expect(canCancelClosedOrder("admin", grants)).toBe(true);
    expect(canDeleteClosedOrder("admin", grants)).toBe(false);
  });

  it("manager can delete but not cancel when only deletion is granted", () => {
    const grants = { cancelClosed: [] as const, deleteClosed: ["manager"] as const };
    expect(canCancelClosedOrder("manager", grants)).toBe(false);
    expect(canDeleteClosedOrder("manager", grants)).toBe(true);
  });

  it("member permissions work independently", () => {
    expect(
      canCancelClosedOrder("member", { cancelClosed: ["member"], deleteClosed: [] }),
    ).toBe(true);
    expect(
      canDeleteClosedOrder("member", { cancelClosed: ["member"], deleteClosed: [] }),
    ).toBe(false);
    expect(
      canDeleteClosedOrder("member", { cancelClosed: [], deleteClosed: ["member"] }),
    ).toBe(true);
  });

  it("offers cancel on open orders without closed-order grants", () => {
    expect(
      canOfferCancelOrderAction({
        order: { status: "in-progress", closedAt: null },
        canWrite: true,
        workspaceRole: "member",
        grants: { cancelClosed: [], deleteClosed: [] },
      }),
    ).toBe(true);
  });

  it("offers cancel on closed orders only with cancel_closed", () => {
    const closed = { status: "closed" as const, closedAt: "2026-01-01T00:00:00.000Z" };
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "admin",
        grants: { cancelClosed: [], deleteClosed: ["admin"] },
      }),
    ).toBe(false);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "admin",
        grants: { cancelClosed: ["admin"], deleteClosed: [] },
      }),
    ).toBe(true);
  });

  it("still requires cancel before delete; closed delete needs delete_closed", () => {
    const closedCancelled = {
      status: "cancelled" as const,
      closedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(
      canOfferDeleteClosedOrderAction({
        order: closedCancelled,
        workspaceRole: "admin",
        grants: { cancelClosed: ["admin"], deleteClosed: [] },
      }),
    ).toBe(false);
    expect(
      canOfferDeleteClosedOrderAction({
        order: closedCancelled,
        workspaceRole: "admin",
        grants: { cancelClosed: [], deleteClosed: ["admin"] },
      }),
    ).toBe(true);
    expect(
      canOfferDeleteClosedOrderAction({
        order: { status: "cancelled", closedAt: null },
        workspaceRole: "member",
        grants: { cancelClosed: [], deleteClosed: [] },
      }),
    ).toBe(true);
  });

  it("admin/manager/member never get owner-manage override even when setting is on", () => {
    const empty = { cancelClosed: [], deleteClosed: [] };
    const closed = { status: "closed" as const, closedAt: "2026-01-01T00:00:00.000Z" };
    for (const role of ["admin", "manager", "member"] as const) {
      expect(
        canOfferCancelOrderAction({
          order: closed,
          canWrite: true,
          workspaceRole: role,
          grants: empty,
          isOwnerByOwnerId: false,
          ownerCanManageClosedOrders: true,
        }),
      ).toBe(false);
      expect(
        canMutateOrderContent({
          order: closed,
          isOwnerByOwnerId: false,
          ownerCanManageClosedOrders: true,
        }),
      ).toBe(false);
    }
  });

  it("owner manage-closed setting unlocks content only for owner_id + enabled", () => {
    const closed = { status: "closed" as const, closedAt: "2026-01-01T00:00:00.000Z" };
    expect(ownerMayManageClosedOrders({ isOwnerByOwnerId: true, ownerCanManageClosedOrders: false })).toBe(false);
    expect(ownerMayManageClosedOrders({ isOwnerByOwnerId: true, ownerCanManageClosedOrders: true })).toBe(true);
    expect(ownerMayManageClosedOrders({ isOwnerByOwnerId: false, ownerCanManageClosedOrders: true })).toBe(false);

    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(false);
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: true,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(true);
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);
    expect(
      canMutateOrderContent({
        order: { status: "in-progress", closedAt: null },
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: false,
      }),
    ).toBe(true);
  });
});
