import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const getStatusDefinitionsByIds = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    from,
    rpc,
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("./apiStatusDefinitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiStatusDefinitions")>();
  return {
    ...actual,
    getStatusDefinitionsByIds,
  };
});

import { closeOrder } from "./apiOrders";

describe("closeOrder", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    getStatusDefinitionsByIds.mockReset();
    getStatusDefinitionsByIds.mockResolvedValue(
      new Map([["d-closed", { id: "d-closed", name: "Closed", color: "#666" }]]),
    );
  });

  it("persists closed lifecycle status and returns closed custom status from RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        idempotent: false,
        status: "closed",
        closed_at: "2026-11-05T10:00:00.000Z",
        custom_status_id: "d-closed",
        remaining: 0,
      },
      error: null,
    });

    await expect(closeOrder("order-1", "ws-1")).resolves.toMatchObject({
      status: "closed",
      closed_at: "2026-11-05T10:00:00.000Z",
      customStatusId: "d-closed",
      customStatus: { name: "Closed", color: "#666" },
    });
    expect(rpc).toHaveBeenCalledWith("close_order_if_settled", {
      p_order_id: "order-1",
      p_workspace_id: "ws-1",
    });
  });

  it("treats null custom_status_id as cleared (no stale regular status)", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        status: "closed",
        closed_at: "2026-11-05T10:00:00.000Z",
        custom_status_id: null,
        remaining: 0,
      },
      error: null,
    });

    await expect(closeOrder("order-1", "ws-1")).resolves.toMatchObject({
      status: "closed",
      customStatusId: null,
      customStatus: null,
    });
  });
});
