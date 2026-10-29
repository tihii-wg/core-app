import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countWorkspaceClients,
  countWorkspaceEmployees,
  countWorkspaceInventory,
  countWorkspaceOrders,
  countWorkspaceServices,
  navCountQueryKey,
} from "./apiNavCounts";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

type CountResult = { count: number | null; error: { message?: string; code?: string } | null };

function countQuery(result: CountResult, onCall?: (method: string, args: unknown[]) => void) {
  const track =
    (method: string) =>
    (...args: unknown[]) => {
      onCall?.(method, args);
      return chain;
    };
  const chain = {
    select: track("select"),
    eq: track("eq"),
    is: track("is"),
    then: (resolve: (value: CountResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

describe("apiNavCounts", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("counts workspace orders with an exact head query", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    from.mockImplementation(() =>
      countQuery({ count: 42, error: null }, (method, args) => calls.push({ method, args })),
    );

    await expect(countWorkspaceOrders("ws-1")).resolves.toBe(42);
    expect(from).toHaveBeenCalledWith("orders");
    expect(calls).toContainEqual({ method: "select", args: ["id", { count: "exact", head: true }] });
    expect(calls).toContainEqual({ method: "eq", args: ["workspace_id", "ws-1"] });
  });

  it("excludes soft-deleted clients by default", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    from.mockImplementation(() =>
      countQuery({ count: 7, error: null }, (method, args) => calls.push({ method, args })),
    );

    await expect(countWorkspaceClients("ws-1")).resolves.toBe(7);
    expect(from).toHaveBeenCalledWith("clients");
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("falls back when clients.deleted_at is missing from the schema", async () => {
    let pass = 0;
    from.mockImplementation(() => {
      pass += 1;
      if (pass === 1) {
        return countQuery({
          count: null,
          error: { code: "42703", message: "column clients.deleted_at does not exist" },
        });
      }
      return countQuery({ count: 3, error: null });
    });

    await expect(countWorkspaceClients("ws-1")).resolves.toBe(3);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("counts only active services to match the Services page default filter", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    from.mockImplementation(() =>
      countQuery({ count: 11, error: null }, (method, args) => calls.push({ method, args })),
    );

    await expect(countWorkspaceServices("ws-1")).resolves.toBe(11);
    expect(from).toHaveBeenCalledWith("services");
    expect(calls).toContainEqual({ method: "eq", args: ["status", "active"] });
  });

  it("counts all inventory items via the status view", async () => {
    from.mockImplementation(() => countQuery({ count: 19, error: null }));

    await expect(countWorkspaceInventory("ws-1")).resolves.toBe(19);
    expect(from).toHaveBeenCalledWith("inventory_items_with_status");
  });

  it("counts all employees in the workspace", async () => {
    from.mockImplementation(() => countQuery({ count: 5, error: null }));

    await expect(countWorkspaceEmployees("ws-1")).resolves.toBe(5);
    expect(from).toHaveBeenCalledWith("employees");
  });

  it("scopes count query keys under entity prefixes for mutation invalidation", () => {
    expect(navCountQueryKey("orders", "ws-1")).toEqual(["orders", "ws-1", "nav-count"]);
    expect(navCountQueryKey("clients", "ws-2")).toEqual(["clients", "ws-2", "nav-count"]);
  });

  it("rejects counts without an active workspace", async () => {
    await expect(countWorkspaceOrders(undefined)).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
});
