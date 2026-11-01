import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, hasPermission, resolvePermissions } from "./permissions";

describe("hasPermission", () => {
  it("falls back to the legacy check when permissions are not available", () => {
    expect(hasPermission(null, "settings.statuses", true)).toBe(true);
    expect(hasPermission(undefined, "settings.statuses", false)).toBe(false);
    expect(hasPermission(null, "settings.statuses")).toBe(true);
  });

  it("matches exact keys when permissions are loaded and ignores the fallback", () => {
    expect(hasPermission(["inventory.receipts.create"], "inventory.receipts.create", false)).toBe(true);
    expect(hasPermission(["inventory.receipts.view"], "inventory.receipts.create", true)).toBe(false);
    expect(hasPermission([], "reports.activity_log", true)).toBe(false);
  });

  it("treats the wildcard as full access", () => {
    expect(hasPermission([ALL_PERMISSIONS], "anything.at.all", false)).toBe(true);
  });
});

describe("resolvePermissions", () => {
  it("gives owners full access regardless of assigned role", () => {
    expect(resolvePermissions({ workspaceRole: "owner", memberRoleId: null, rolePermissions: [] })).toEqual(["*"]);
    expect(resolvePermissions({ workspaceRole: "owner", memberRoleId: "r1", rolePermissions: ["a.b"] })).toEqual(["*"]);
  });

  it("gives admins without a member role full access", () => {
    expect(resolvePermissions({ workspaceRole: "admin", memberRoleId: null, rolePermissions: [] })).toEqual(["*"]);
  });

  it("limits admins with a member role to that role", () => {
    expect(resolvePermissions({ workspaceRole: "admin", memberRoleId: "r1", rolePermissions: ["a.b", "a.b"] })).toEqual(["a.b"]);
  });

  it("gives managers and members nothing without a member role", () => {
    expect(resolvePermissions({ workspaceRole: "manager", memberRoleId: null, rolePermissions: [] })).toEqual([]);
    expect(resolvePermissions({ workspaceRole: "member", memberRoleId: undefined, rolePermissions: [] })).toEqual([]);
  });

  it("uses role permissions for assigned members", () => {
    const perms = resolvePermissions({ workspaceRole: "manager", memberRoleId: "r1", rolePermissions: ["inventory.receipts.create"] });
    expect(hasPermission(perms, "inventory.receipts.create", false)).toBe(true);
    expect(hasPermission(perms, "settings.statuses", true)).toBe(false);
  });
});
