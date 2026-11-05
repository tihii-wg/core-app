import { describe, expect, it } from "vitest";
import {
  canCancelClosedOrder,
  canDeleteClosedOrder,
  canOfferCancelOrderAction,
  canOfferDeleteClosedOrderAction,
} from "./closedOrderPermissions";

describe("closed order UI permission helpers", () => {
  it("owner can always cancel and delete closed orders", () => {
    const empty = { cancelClosed: [], deleteClosed: [] };
    expect(canCancelClosedOrder("owner", empty)).toBe(true);
    expect(canDeleteClosedOrder("owner", empty)).toBe(true);
    expect(
      canOfferCancelOrderAction({
        order: { status: "closed", closedAt: "2026-01-01T00:00:00.000Z" },
        canWrite: true,
        workspaceRole: "member",
        grants: empty,
        isOwnerByOwnerId: true,
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

  it("owner_id bypasses role grants for cancel and delete of closed orders", () => {
    const empty = { cancelClosed: [], deleteClosed: [] };
    const closed = { status: "closed" as const, closedAt: "2026-01-01T00:00:00.000Z" };
    const closedCancelled = { status: "cancelled" as const, closedAt: "2026-01-01T00:00:00.000Z" };
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "member",
        grants: empty,
        isOwnerByOwnerId: true,
      }),
    ).toBe(true);
    expect(
      canOfferDeleteClosedOrderAction({
        order: closedCancelled,
        workspaceRole: "member",
        grants: empty,
        isOwnerByOwnerId: true,
      }),
    ).toBe(true);
    expect(
      canOfferCancelOrderAction({
        order: closed,
        canWrite: true,
        workspaceRole: "member",
        grants: empty,
        isOwnerByOwnerId: false,
      }),
    ).toBe(false);
  });
});
