import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const assertVehicleAssignable = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    from,
    rpc,
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } }, error: null }),
    },
  },
}));

vi.mock("./apiActivityLog", () => ({
  recordActivity: vi.fn(async () => undefined),
}));

vi.mock("./apiVehicles", async () => {
  const actual = await vi.importActual<typeof import("./apiVehicles")>("./apiVehicles");
  return {
    ...actual,
    assertVehicleAssignable: (...args: unknown[]) => assertVehicleAssignable(...args),
  };
});

import {
  changeOrderClient,
  resolvePayerClientIdAfterClientChange,
} from "./apiOrders";

function chainResult(result: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.is = self;
  chain.order = self;
  chain.in = self;
  chain.limit = self;
  chain.update = self;
  chain.insert = self;
  chain.delete = self;
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

describe("resolvePayerClientIdAfterClientChange", () => {
  it("moves payer when it matched the old client or was unset", () => {
    expect(resolvePayerClientIdAfterClientChange("c-old", "c-old", "c-new")).toBe("c-new");
    expect(resolvePayerClientIdAfterClientChange("c-old", null, "c-new")).toBe("c-new");
    expect(resolvePayerClientIdAfterClientChange("c-old", undefined, "c-new")).toBe("c-new");
  });

  it("keeps a distinct payer", () => {
    expect(resolvePayerClientIdAfterClientChange("c-old", "c-payer", "c-new")).toBe("c-payer");
  });
});

describe("changeOrderClient", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    assertVehicleAssignable.mockReset();
    assertVehicleAssignable.mockImplementation(async (_ws: string, _client: string, vehicleId: string | null) => vehicleId);
  });

  it("rejects a vehicle that belongs to another client", async () => {
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return chainResult({
          data: { id: "order-1", client_id: "c-old", payer_client_id: "c-old", vehicle_id: null, status: "new", closed_at: null },
          error: null,
        });
      }
      return chainResult({ data: null, error: null, count: 0 });
    });
    assertVehicleAssignable.mockRejectedValue(new Error("vehicles.errors.invalidSelection"));

    await expect(
      changeOrderClient("order-1", { clientId: "c-new", vehicleId: "v-other" }, "ws-1"),
    ).rejects.toThrow(/invalidSelection|vehicles\.errors/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects closed orders before calling the RPC", async () => {
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return chainResult({
          data: {
            id: "order-1",
            client_id: "c-old",
            payer_client_id: "c-old",
            vehicle_id: null,
            status: "closed",
            closed_at: "2026-01-01T00:00:00.000Z",
          },
          error: null,
        });
      }
      return chainResult({ data: null, error: null, count: 0 });
    });

    await expect(
      changeOrderClient("order-1", { clientId: "c-new", vehicleId: null }, "ws-1"),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects cancelled orders", async () => {
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return chainResult({
          data: {
            id: "order-1",
            client_id: "c-old",
            payer_client_id: "c-old",
            vehicle_id: null,
            status: "cancelled",
            closed_at: null,
          },
          error: null,
        });
      }
      return chainResult({ data: null, error: null, count: 0 });
    });

    await expect(
      changeOrderClient("order-1", { clientId: "c-new", vehicleId: null }, "ws-1"),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires invoice confirmation when an invoice exists", async () => {
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return chainResult({
          data: {
            id: "order-1",
            client_id: "c-old",
            payer_client_id: "c-old",
            vehicle_id: null,
            status: "new",
            closed_at: null,
          },
          error: null,
        });
      }
      if (table === "invoices") {
        return chainResult({ data: null, error: null, count: 1 });
      }
      return chainResult({ data: null, error: null, count: 0 });
    });

    await expect(
      changeOrderClient("order-1", { clientId: "c-new", vehicleId: null }, "ws-1"),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
