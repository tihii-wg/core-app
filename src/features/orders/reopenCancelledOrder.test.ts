import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOrderCurrentlyClosed, isOrderFormallyClosed } from "./orderLifecycle";
import { resolveUnifiedStatusSelection, unifiedStatusOptions } from "./unifiedOrderStatus";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import type { Order } from "../../lib/types";

/**
 * Regression: close → cancel (owner) → status to in-progress → open again → Close Order.
 * DB reopen clears closed_at; UI must unlock Close and hide closed banner.
 */
describe("reopen cancelled order lifecycle (client gates)", () => {
  const closedAt = "2026-11-01T12:00:00.000Z";
  const label = (status: string) => status;

  const definitions: StatusDefinition[] = [
    {
      id: "d-progress",
      workspaceId: "ws",
      entity: "order",
      name: "In Progress",
      code: "in_progress",
      color: null,
      systemStatus: "in-progress",
      semanticAction: "normal",
      statusGroup: "in_progress",
      sortOrder: 1,
      isDefault: false,
      isActive: true,
      showOverdueBadge: false,
      addsToBackorders: false,
    },
  ];

  it("keeps cancelled formal-closed until closed_at is cleared", () => {
    const cancelled = { status: "cancelled" as const, closedAt };
    expect(isOrderFormallyClosed(cancelled)).toBe(true);
    expect(isOrderCurrentlyClosed(cancelled)).toBe(false);

    const reopened = { status: "in-progress" as const, closedAt: null };
    expect(isOrderFormallyClosed(reopened)).toBe(false);
    expect(isOrderCurrentlyClosed(reopened)).toBe(false);
  });

  it("blocks non-owner reopen selection while allowing owner reopen", () => {
    const options = unifiedStatusOptions(definitions, label);
    const progress = options[0]!;
    const cancelled = { status: "cancelled" as const, closedAt, customStatusId: null } as Pick<
      Order,
      "status" | "closedAt" | "customStatusId"
    >;

    expect(resolveUnifiedStatusSelection(cancelled, progress)).toBeNull();
    expect(resolveUnifiedStatusSelection(cancelled, progress, { allowManageClosed: true })).toBeNull();
    expect(resolveUnifiedStatusSelection(cancelled, progress, { allowReopenCancelled: true })).toEqual({
      status: "in-progress",
      customStatusId: "d-progress",
    });
  });

  it("after reopen, Close Order eligibility matches an ordinary open order", () => {
    const reopened: Pick<Order, "status" | "closedAt"> = { status: "in-progress", closedAt: null };
    const showClose = !isOrderFormallyClosed(reopened) && reopened.status !== "cancelled";
    expect(showClose).toBe(true);
  });
});

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("../../services/supabase", () => ({
  default: {
    auth: { getUser },
    from,
    rpc,
  },
}));

vi.mock("../../i18n", () => ({
  default: { t: (key: string) => key },
}));

vi.mock("../../services/apiStatusDefinitions", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiStatusDefinitions")>(
    "../../services/apiStatusDefinitions",
  );
  return {
    ...actual,
    getStatusDefinitionsByIds: vi.fn(async () => new Map()),
    resolveCustomStatusForSystemStatus: vi.fn(async () => null),
  };
});

vi.mock("../../services/apiActivityLog", () => ({
  recordActivity: vi.fn(async () => undefined),
}));

import { updateOrderStatus } from "../../services/apiOrders";

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "update", "maybeSingle", "neq"]) {
    api[method] = vi.fn(() => api);
  }
  api.maybeSingle = vi.fn(async () => result);
  api.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return api;
}

describe("updateOrderStatus reopen-from-cancelled", () => {
  beforeEach(() => {
    from.mockReset();
    getUser.mockReset();
    rpc.mockReset();
  });

  it("calls reopen_cancelled_order for workspace owner_id and returns cleared closedAt", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    from
      .mockReturnValueOnce(
        chain({
          data: {
            id: "order-1",
            status: "cancelled",
            closed_at: "2026-11-01T00:00:00.000Z",
            custom_status_id: null,
          },
          error: null,
        }),
      )
      // isWorkspaceOwnerIdOnServer
      .mockReturnValueOnce(chain({ data: { id: "ws-1" }, error: null }));

    rpc.mockResolvedValue({
      data: {
        ok: true,
        order_id: "order-1",
        status: "in-progress",
        closed_at: null,
        custom_status_id: null,
      },
      error: null,
    });

    const result = await updateOrderStatus("order-1", "in-progress", "ws-1");
    expect(rpc).toHaveBeenCalledWith("reopen_cancelled_order", {
      p_order_id: "order-1",
      p_workspace_id: "ws-1",
      p_status: "in-progress",
      p_custom_status_id: null,
    });
    expect(result).toEqual({
      status: "in-progress",
      customStatusId: null,
      customStatus: null,
      closedAt: null,
    });
  });

  it("rejects reopen for non-owners without calling the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    from
      .mockReturnValueOnce(
        chain({
          data: {
            id: "order-1",
            status: "cancelled",
            closed_at: "2026-11-01T00:00:00.000Z",
            custom_status_id: null,
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(chain({ data: null, error: null }));

    await expect(updateOrderStatus("order-1", "in-progress", "ws-1")).rejects.toThrow(
      /orders\.lifecycle\.errors\.orderAlreadyCancelled/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
