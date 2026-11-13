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

const empty = { cancelClosed: [] as const, deleteClosed: [] as const, closedFullAccess: [] as const };

describe("roleHasClosedOrderPermission", () => {
  it("does not treat membership role owner as an automatic closed-order grant", () => {
    expect(roleHasClosedOrderPermission("owner", CLOSED_ORDER_PERMISSIONS.cancelClosed, empty)).toBe(false);
    expect(roleHasClosedOrderPermission("owner", CLOSED_ORDER_PERMISSIONS.deleteClosed, empty)).toBe(false);
    expect(roleHasClosedOrderPermission("owner", CLOSED_ORDER_PERMISSIONS.closedFullAccess, empty)).toBe(false);
  });

  it("denies admin/manager/member by default", () => {
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.cancelClosed, empty)).toBe(false);
    expect(roleHasClosedOrderPermission("manager", CLOSED_ORDER_PERMISSIONS.deleteClosed, empty)).toBe(false);
    expect(roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.cancelClosed, empty)).toBe(false);
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.closedFullAccess, empty)).toBe(false);
  });

  it("grants cancel and delete independently per role", () => {
    const grants = { ...empty, cancelClosed: ["admin"] as const, deleteClosed: ["manager"] as const };
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(true);
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.deleteClosed, grants)).toBe(false);
    expect(roleHasClosedOrderPermission("manager", CLOSED_ORDER_PERMISSIONS.deleteClosed, grants)).toBe(true);
    expect(roleHasClosedOrderPermission("manager", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(false);
    expect(roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(false);
  });

  it("allows member to receive either permission independently", () => {
    expect(
      roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.cancelClosed, {
        ...empty,
        cancelClosed: ["member"],
      }),
    ).toBe(true);
    expect(
      roleHasClosedOrderPermission("member", CLOSED_ORDER_PERMISSIONS.deleteClosed, {
        ...empty,
        deleteClosed: ["member"],
      }),
    ).toBe(true);
  });

  it("full access implies cancel and delete for that role", () => {
    const grants = { ...empty, closedFullAccess: ["admin"] as const };
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.closedFullAccess, grants)).toBe(true);
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(true);
    expect(roleHasClosedOrderPermission("admin", CLOSED_ORDER_PERMISSIONS.deleteClosed, grants)).toBe(true);
    expect(roleHasClosedOrderPermission("manager", CLOSED_ORDER_PERMISSIONS.cancelClosed, grants)).toBe(false);
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
            { permission: "orders.closed_full_access", workspace_role: "admin" },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected ${table}`);
    });

    await expect(getClosedOrderPermissionGrants("ws-1")).resolves.toEqual({
      cancelClosed: ["admin"],
      deleteClosed: ["manager", "member"],
      closedFullAccess: ["admin"],
    });
  });

  it("returns empty grants when the table is not deployed yet", async () => {
    from.mockImplementation(() => selectQuery({ data: null, error: { code: "PGRST205", message: "missing" } }));
    await expect(getClosedOrderPermissionGrants("ws-1")).resolves.toEqual({
      cancelClosed: [],
      deleteClosed: [],
      closedFullAccess: [],
    });
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
        closedFullAccess: [],
      }),
    ).resolves.toEqual({ cancelClosed: ["admin"], deleteClosed: [], closedFullAccess: [] });
    expect(calls.length).toBe(3);
  });

  it("omits redundant cancel/delete rows when full access is set, and surfaces schema error", async () => {
    const inserted: unknown[] = [];
    from.mockImplementation((table: string) => {
      if (table !== "workspace_role_permission_grants") throw new Error(table);
      return {
        delete: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        insert: (rows: unknown) => {
          inserted.push(rows);
          return Promise.resolve({ data: null, error: null });
        },
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [{ permission: "orders.closed_full_access", workspace_role: "manager" }],
              error: null,
            }),
        }),
      };
    });

    await expect(
      saveClosedOrderPermissionGrants("ws-1", {
        closedFullAccess: ["manager"],
        cancelClosed: ["manager", "admin"],
        deleteClosed: ["manager"],
      }),
    ).resolves.toEqual({
      cancelClosed: [],
      deleteClosed: [],
      closedFullAccess: ["manager"],
    });
    expect(inserted[0]).toEqual([
      { workspace_id: "ws-1", permission: "orders.closed_full_access", workspace_role: "manager" },
      { workspace_id: "ws-1", permission: "orders.cancel_closed", workspace_role: "admin" },
    ]);
  });

  it("throws fullAccessSchemaRequired when constraint rejects closed_full_access", async () => {
    from.mockImplementation(() =>
      deleteQuery({ data: null, error: { code: "23514", message: "orders.closed_full_access" } }),
    );
    await expect(
      saveClosedOrderPermissionGrants("ws-1", {
        closedFullAccess: ["admin"],
        cancelClosed: [],
        deleteClosed: [],
      }),
    ).rejects.toThrow(/20261114200000_closed_order_full_access/);
  });
});
