import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser },
    from,
  },
}));

vi.mock("../i18n", () => ({
  default: { t: (key: string) => key },
}));

import { ownerMayManageClosedOrdersOnServer, updateOrderStatus } from "./apiOrders";

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "update", "maybeSingle", "neq"]) {
    api[method] = vi.fn(() => api);
  }
  api.maybeSingle = vi.fn(async () => result);
  api.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return api;
}

describe("ownerMayManageClosedOrdersOnServer", () => {
  beforeEach(() => {
    from.mockReset();
    getUser.mockReset();
  });

  it("returns false when the signed-in user is not owner_id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    from.mockReturnValue(chain({ data: null, error: null }));
    expect(await ownerMayManageClosedOrdersOnServer("ws-1")).toBe(false);
  });

  it("returns true only when owner_id matches and setting is enabled", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from.mockReturnValue(chain({ data: { owner_can_manage_closed_orders: true }, error: null }));
    expect(await ownerMayManageClosedOrdersOnServer("ws-1")).toBe(true);

    from.mockReturnValue(chain({ data: { owner_can_manage_closed_orders: false }, error: null }));
    expect(await ownerMayManageClosedOrdersOnServer("ws-1")).toBe(false);
  });

  it("treats a missing column as disabled", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from.mockReturnValue(chain({ data: null, error: { code: "PGRST204", message: "owner_can_manage_closed_orders" } }));
    expect(await ownerMayManageClosedOrdersOnServer("ws-1")).toBe(false);
  });
});

describe("updateOrderStatus closed-order gate", () => {
  beforeEach(() => {
    from.mockReset();
    getUser.mockReset();
  });

  it("rejects closed-order status changes when owner manage setting is off", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    // First from(): load existing order; second: owner manage check
    from
      .mockReturnValueOnce(
        chain({
          data: { id: "order-1", status: "closed", closed_at: "2026-11-01T00:00:00.000Z", custom_status_id: null },
          error: null,
        }),
      )
      .mockReturnValueOnce(chain({ data: { owner_can_manage_closed_orders: false }, error: null }));

    await expect(updateOrderStatus("order-1", "in-progress", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.orderAlreadyClosed/,
    );
  });

  it("rejects closed-order status changes for non-owners even when setting appears enabled", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    from
      .mockReturnValueOnce(
        chain({
          data: { id: "order-1", status: "closed", closed_at: "2026-11-01T00:00:00.000Z", custom_status_id: null },
          error: null,
        }),
      )
      // Non-owner query against owner_id returns null
      .mockReturnValueOnce(chain({ data: null, error: null }));

    await expect(updateOrderStatus("order-1", "in-progress", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.orderAlreadyClosed/,
    );
  });
});
