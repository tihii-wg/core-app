import { beforeEach, describe, expect, it, vi } from "vitest";
import { countClientOrders } from "./apiOrders";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

type CountResult = { count: number | null; error: { message?: string } | null };

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
    then: (resolve: (value: CountResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

describe("countClientOrders", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("counts with workspace_id + client_id exact head query", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    from.mockImplementation(() =>
      countQuery({ count: 12, error: null }, (method, args) => calls.push({ method, args })),
    );

    await expect(countClientOrders("ws-1", "client-1")).resolves.toBe(12);
    expect(from).toHaveBeenCalledWith("orders");
    expect(calls).toContainEqual({ method: "select", args: ["id", { count: "exact", head: true }] });
    expect(calls).toContainEqual({ method: "eq", args: ["workspace_id", "ws-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["client_id", "client-1"] });
  });

  it("returns 0 for an empty client id without querying", async () => {
    await expect(countClientOrders("ws-1", "  ")).resolves.toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 0 when count is null", async () => {
    from.mockImplementation(() => countQuery({ count: null, error: null }));
    await expect(countClientOrders("ws-1", "client-1")).resolves.toBe(0);
  });

  it("throws when the query errors", async () => {
    from.mockImplementation(() => countQuery({ count: null, error: { message: "boom" } }));
    await expect(countClientOrders("ws-1", "client-1")).rejects.toThrow("boom");
  });
});
