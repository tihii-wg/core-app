import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertVehicleAssignable } from "./apiVehicles";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    from,
  },
}));

vi.mock("../i18n", () => ({
  default: {
    t: (key: string) => key,
  },
}));

function maybeSingleQuery(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  return chain;
}

describe("assertVehicleAssignable", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("allows null vehicle id (no association)", async () => {
    await expect(assertVehicleAssignable("ws-1", "client-1", null)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a vehicle when no client is selected", async () => {
    await expect(assertVehicleAssignable("ws-1", null, "veh-1")).rejects.toThrow(/vehicleNeedsClient/);
  });

  it("rejects a vehicle from another client or workspace", async () => {
    from.mockReturnValue(maybeSingleQuery({ data: null, error: null }));
    await expect(assertVehicleAssignable("ws-1", "client-1", "veh-other")).rejects.toThrow(/invalidSelection/);
    expect(from).toHaveBeenCalledWith("vehicles");
  });

  it("accepts a vehicle that belongs to the client and workspace", async () => {
    from.mockReturnValue(maybeSingleQuery({ data: { id: "veh-1" }, error: null }));
    await expect(assertVehicleAssignable("ws-1", "client-1", "veh-1")).resolves.toBe("veh-1");
  });
});
