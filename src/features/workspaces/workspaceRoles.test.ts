import { describe, expect, it } from "vitest";
import { assignableWorkspaceRoles, canManageWorkspaceMember } from "./workspaceRoles";

describe("workspace role permissions", () => {
  it("lets an owner manage admins, managers, and members", () => {
    expect(assignableWorkspaceRoles("owner")).toEqual(["admin", "manager", "member"]);
    expect(canManageWorkspaceMember("owner", "admin")).toBe(true);
    expect(canManageWorkspaceMember("owner", "member")).toBe(true);
    expect(canManageWorkspaceMember("owner", "owner")).toBe(false);
  });

  it("lets an admin manage only managers and members", () => {
    expect(assignableWorkspaceRoles("admin")).toEqual(["manager", "member"]);
    expect(canManageWorkspaceMember("admin", "manager")).toBe(true);
    expect(canManageWorkspaceMember("admin", "admin")).toBe(false);
    expect(canManageWorkspaceMember("admin", "owner")).toBe(false);
  });

  it("gives managers and members read-only access", () => {
    for (const role of ["manager", "member", null, "unknown"]) {
      expect(assignableWorkspaceRoles(role)).toEqual([]);
      expect(canManageWorkspaceMember(role, "member")).toBe(false);
    }
  });
});
