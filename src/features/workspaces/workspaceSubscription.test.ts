import { describe, expect, it } from "vitest";
import {
  hasSubscriptionWriteEntitlement,
  normalizeSubscriptionStatus,
  withSubscriptionWriteAccess,
  type WorkspaceSubscriptionFields,
} from "./workspaceSubscription";
import { canMutateOrderAttachments } from "../orders/orderAttachments";
import { canManageServices, canManageWarehouse, canManageWorkspace } from "./workspaceRoles";

const now = new Date("2026-06-15T12:00:00.000Z");

function fields(
  status: WorkspaceSubscriptionFields["subscriptionStatus"],
  expiresAt: string | null = null,
): WorkspaceSubscriptionFields {
  return {
    subscriptionStatus: status,
    subscriptionStartedAt: "2026-01-01T00:00:00.000Z",
    subscriptionExpiresAt: expiresAt,
    subscriptionUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("hasSubscriptionWriteEntitlement", () => {
  it("allows active with no expiry", () => {
    expect(hasSubscriptionWriteEntitlement(fields("active", null), now)).toBe(true);
  });

  it("allows active with a future expiry", () => {
    expect(hasSubscriptionWriteEntitlement(fields("active", "2026-12-31T00:00:00.000Z"), now)).toBe(true);
  });

  it("denies active when expiry is in the past", () => {
    expect(hasSubscriptionWriteEntitlement(fields("active", "2026-01-01T00:00:00.000Z"), now)).toBe(false);
  });

  it("allows trial with a future expiry", () => {
    expect(hasSubscriptionWriteEntitlement(fields("trial", "2026-07-01T00:00:00.000Z"), now)).toBe(true);
  });

  it("denies trial with missing expiry", () => {
    expect(hasSubscriptionWriteEntitlement(fields("trial", null), now)).toBe(false);
  });

  it("denies expired, suspended, and cancelled", () => {
    expect(hasSubscriptionWriteEntitlement(fields("expired", null), now)).toBe(false);
    expect(hasSubscriptionWriteEntitlement(fields("suspended", "2027-01-01T00:00:00.000Z"), now)).toBe(false);
    expect(hasSubscriptionWriteEntitlement(fields("cancelled", "2027-01-01T00:00:00.000Z"), now)).toBe(false);
  });

  it("denies missing and unknown statuses", () => {
    expect(hasSubscriptionWriteEntitlement(fields(null, null), now)).toBe(false);
    expect(hasSubscriptionWriteEntitlement({ ...fields(null), subscriptionStatus: normalizeSubscriptionStatus("bogus") }, now)).toBe(false);
    expect(hasSubscriptionWriteEntitlement(undefined, now)).toBe(false);
    expect(hasSubscriptionWriteEntitlement(null, now)).toBe(false);
  });

  it("denies past expiry regardless of status label", () => {
    expect(hasSubscriptionWriteEntitlement(fields("trial", "2020-01-01T00:00:00.000Z"), now)).toBe(false);
    expect(hasSubscriptionWriteEntitlement(fields("active", "2020-01-01T00:00:00.000Z"), now)).toBe(false);
  });
});

describe("role + subscription interaction", () => {
  it("never elevates role permissions via subscription", () => {
    expect(withSubscriptionWriteAccess(canManageServices("member"), true)).toBe(false);
    expect(withSubscriptionWriteAccess(canManageWarehouse("member"), true)).toBe(false);
    expect(withSubscriptionWriteAccess(canManageWorkspace("admin"), true)).toBe(false);
    expect(withSubscriptionWriteAccess(canManageServices("owner"), true)).toBe(true);
    expect(withSubscriptionWriteAccess(canManageServices("owner"), false)).toBe(false);
  });

  it("blocks attachment mutations when subscription write entitlement is denied", () => {
    expect(canMutateOrderAttachments("owner", { hasActiveSubscription: true })).toBe(true);
    expect(canMutateOrderAttachments("owner", { hasActiveSubscription: false })).toBe(false);
    expect(canMutateOrderAttachments("member", { hasActiveSubscription: false })).toBe(false);
  });
});

describe("normalizeSubscriptionStatus", () => {
  it("accepts known statuses and rejects unknown values", () => {
    expect(normalizeSubscriptionStatus("Active")).toBe("active");
    expect(normalizeSubscriptionStatus("trial")).toBe("trial");
    expect(normalizeSubscriptionStatus("mystery")).toBeNull();
    expect(normalizeSubscriptionStatus(null)).toBeNull();
  });
});
