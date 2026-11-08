import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() =>
  vi.fn(async () => {
    const result = await getUser();
    return {
      data: { session: result?.data?.user ? { user: result.data.user } : null },
      error: result?.error ?? null,
    };
  }),
);
const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser, getSession },
    from,
  },
}));

vi.mock("../i18n", () => ({
  default: { t: (key: string) => key },
}));

import {
  assertClosedOrderMutableOnServer,
  ownerMayManageClosedOrdersOnServer,
  updateOrder,
  updateOrderStatus,
} from "./apiOrders";

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

  it("rejects closed-order status changes for the owner", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { id: "order-1", status: "closed", closed_at: "2026-11-01T00:00:00.000Z", custom_status_id: null },
        error: null,
      }),
    );

    await expect(updateOrderStatus("order-1", "in-progress", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.closedOrderImmutable/,
    );
  });

  it("rejects closed-order status changes for non-owners", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { id: "order-1", status: "closed", closed_at: "2026-11-01T00:00:00.000Z", custom_status_id: null },
        error: null,
      }),
    );

    await expect(updateOrderStatus("order-1", "in-progress", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.closedOrderImmutable/,
    );
  });
});

describe("assertClosedOrderMutableOnServer authorization matrix", () => {
  beforeEach(() => {
    from.mockReset();
    getUser.mockReset();
  });

  it("denies actual owner even when setting is ON", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { status: "closed", closed_at: "2026-11-01T00:00:00.000Z" },
        error: null,
      }),
    );

    await expect(assertClosedOrderMutableOnServer("order-1", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.closedOrderImmutable/,
    );
  });

  it("denies actual owner when setting is OFF", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { status: "closed", closed_at: "2026-11-01T00:00:00.000Z" },
        error: null,
      }),
    );

    await expect(assertClosedOrderMutableOnServer("order-1", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.closedOrderImmutable/,
    );
  });

  it.each([
    ["admin", "admin-1"],
    ["manager", "manager-1"],
    ["member", "member-1"],
  ] as const)("denies %s even when setting is ON", async (_role, userId) => {
    getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { status: "closed", closed_at: "2026-11-01T00:00:00.000Z" },
        error: null,
      }),
    );

    await expect(assertClosedOrderMutableOnServer("order-1", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.closedOrderImmutable/,
    );
  });

  it("allows mutations on open orders without checking the owner setting", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "member-1" } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { status: "in-progress", closed_at: null },
        error: null,
      }),
    );

    await expect(assertClosedOrderMutableOnServer("order-1", "ws-1")).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("allows cancelled orders for workspace owner_id without the manage-closed setting", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from
      .mockReturnValueOnce(
        chain({
          data: { status: "cancelled", closed_at: "2026-11-01T00:00:00.000Z" },
          error: null,
        }),
      )
      // isWorkspaceOwnerIdOnServer — owner_id match, no setting column required
      .mockReturnValueOnce(chain({ data: { id: "ws-1" }, error: null }));

    await expect(assertClosedOrderMutableOnServer("order-1", "ws-1")).resolves.toBeUndefined();
  });

  it("denies cancelled orders for non-owners even when manage-closed setting is ON", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    from
      .mockReturnValueOnce(
        chain({
          data: { status: "cancelled", closed_at: "2026-11-01T00:00:00.000Z" },
          error: null,
        }),
      )
      .mockReturnValueOnce(chain({ data: null, error: null }));

    await expect(assertClosedOrderMutableOnServer("order-1", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.closedOrderImmutable/,
    );
  });
});

describe("updateOrder closed-order gate", () => {
  beforeEach(() => {
    from.mockReset();
    getUser.mockReset();
  });

  it("rejects closed-order field edits for the owner even when setting is on", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { client_id: "c1", status: "closed", closed_at: "2026-11-01T00:00:00.000Z" },
        error: null,
      }),
    );

    await expect(
      updateOrder(
        {
          orderId: "order-1",
          device: "Phone",
          carNumber: "",
          vin: "",
          description: "x",
          assignedEmployeeId: "",
          deadline: "",
        },
        "ws-1",
      ),
    ).rejects.toThrow(/orders\.lifecycle\.errors\.closedOrderImmutable/);
  });

  it("rejects closed-order field edits for admin", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    from.mockReturnValueOnce(
      chain({
        data: { client_id: "c1", status: "closed", closed_at: "2026-11-01T00:00:00.000Z" },
        error: null,
      }),
    );

    await expect(
      updateOrder(
        {
          orderId: "order-1",
          device: "Phone",
          carNumber: "",
          vin: "",
          description: "x",
          assignedEmployeeId: "",
          deadline: "",
        },
        "ws-1",
      ),
    ).rejects.toThrow(/orders\.lifecycle\.errors\.closedOrderImmutable/);
  });

  it("does not apply the closed-immutable rejection to cancelled orders for owner_id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from
      .mockReturnValueOnce(
        chain({
          data: { client_id: "c1", status: "cancelled", closed_at: "2026-11-01T00:00:00.000Z" },
          error: null,
        }),
      )
      .mockReturnValueOnce(chain({ data: { id: "ws-1" }, error: null }));

    // Past the cancelled+owner gate; later update mocks are incomplete so any error must not be the closed lock.
    await expect(
      updateOrder(
        {
          orderId: "order-1",
          device: "Phone",
          carNumber: "",
          vin: "",
          description: "x",
          assignedEmployeeId: "",
          deadline: "",
        },
        "ws-1",
      ),
    ).rejects.not.toThrow(/orders\.lifecycle\.errors\.closedOrderImmutable/);
  });
});
