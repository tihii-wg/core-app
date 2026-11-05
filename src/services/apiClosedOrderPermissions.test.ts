import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSED_ORDER_PERMISSIONS,
  getClosedOrderPermissionGrants,
  roleHasClosedOrderPermission,
  saveClosedOrderPermissionGrants,
} from "./apiClosedOrderPermissions";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

function selectQuery(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => Promise.resolve(result);
  return chain;
}

function deleteQuery(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.delete = () => chain;
  chain.eq = () => chain;
  chain.in = () => Promise.resolve(result);
  return chain;
}

function insertQuery(result: { data: unknown; error: unknown }) {
  return {
    insert: () => Promise.resolve(result),
  };
}

describe("roleHasClosedOrderPermission", () => {
  it("always allows the owner for both permissions", () => {
    expect(roleHasClosedOrderPermission("owner", CLOSED_ORDER_PERMISSIONS.cancelClosed, { cancelClosed: [], deleteClosed: [] })).toBe(true);
    expect(roleHasClosedOrderPermission("owner", CLOSED_ORDER_PERMISSIONS.deleteClosed, { cancelClosed: [], deleteClosed: [] })).toBe(true);
  });

  it("denies admin/manager/member by default", () => {
    const empty = { cancelClosed: [] as Array<"admin" | "manager" | "member">, deleteClosed: [] as Array<"admin" | "manager" | "member"> };
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.cancelClosed, empty)).toBe(false);
    expect(roleHasClosedOrderPermission("manager", CLOSED_ORDER_PERMISSIONS.deleteClosed, empty)).toBe(false);
    expect(roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.cancelClosed, empty)).toBe(false);
  });

  it("grants cancel and delete independently per role", () => {
    const grants = { cancelClosed: ["admin" as const], deleteClosed: ["manager" as const] };
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(true);
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.deleteClosed, grants)).toBe(false);
    expect(roleHasClosedOrderPermission("manager", CLOSED_ORDER_PERMISSIONS.deleteClosed, grants)).toBe(true);
    expect(roleHasClosedOrderPermission("manager", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(false);
    expect(roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(false);
  });

  it("allows member to receive either permission independently", () => {
    expect(
      roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.cancelClosed, {
        cancelClosed: ["member"],
        deleteClosed: [],
      }),
    ).toBe(true);
    expect(
      roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.deleteClosed, {
        cancelClosed: [],
        deleteClosed: ["member"],
      }),
    ).toBe(true);
  });
});

describe("getClosedOrderPermissionGrants / saveClosedOrderPermissionGrants", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("loads grants grouped by permission", async () => {
    from.mockImplementation((table: string) => {
      if (table === "workspace_role_permission_grants") {
        return selectQuery({
          data: [
            { permission: "orders.cancel_closed", workspace_role: "admin" },
            { permission: "orders.delete_closed", workspace_role: "manager" },
            { permission: "orders.delete_closed", workspace_role: "member" },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected ${table}`);
    });

    await expect(getClosedOrderPermissionGrants("ws-1")).resolves.toEqual({
      cancelClosed: ["admin"],
      deleteClosed: ["manager", "member"],
    });
  });

  it("returns empty grants when the table is not deployed yet", async () => {
    from.mockImplementation(() => selectQuery({ data: null, error: { code: "PGRST205", message: "missing" } }));
    await expect(getClosedOrderPermissionGrants("ws-1")).resolves.toEqual({ cancelClosed: [], deleteClosed: [] });
  });

  it("replaces grants so a revoked role loses access immediately on next load", async () => {
    const calls: string[] = [];
    from.mockImplementation((table: string) => {
      if (table !== "workspace_role_permission_grants") throw new Error(table);
      calls.push("touch");
      if (calls.length === 1) return deleteQuery({ data: null, error: null });
      if (calls.length === 2) return insertQuery({ data: null, error: null });
      return selectQuery({
        data: [{ permission: "orders.cancel_closed", workspace_role: "admin" }],
        error: null,
      });
    });

    await expect(
      saveClosedOrderPermissionGrants("ws-1", {
        cancelClosed: ["admin"],
        deleteClosed: [],
      }),
    ).resolves.toEqual({ cancelClosed: ["admin"], deleteClosed: [] });
    expect(calls.length).toBe(3);
  });
});
