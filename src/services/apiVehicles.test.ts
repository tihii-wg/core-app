import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vehicle } from "../lib/types";
import { assertVehicleAssignable, orderAssetFieldsFromVehicle, vehicleMakeModelLabel } from "./apiVehicles";

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

describe("orderAssetFieldsFromVehicle", () => {
  const base: Vehicle = {
    id: "veh-1",
    workspaceId: "ws-1",
    clientId: "client-1",
    make: "Toyota",
    model: "Corolla",
    year: 2018,
    vin: "1HGBH41JXMN109186",
    licensePlate: "ABC123",
    initialMileage: null,
    currentMileage: null,
    engineDisplacement: null,
    fuelType: null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };

  it("maps make/model/year, plate, and VIN into order snapshot fields", () => {
    expect(vehicleMakeModelLabel(base)).toBe("Toyota Corolla 2018");
    expect(orderAssetFieldsFromVehicle(base)).toEqual({
      device: "Toyota Corolla 2018",
      carNumber: "ABC123",
      vin: "1HGBH41JXMN109186",
    });
  });

  it("keeps empty strings when vehicle fields are null", () => {
    expect(
      orderAssetFieldsFromVehicle({
        ...base,
        make: null,
        model: null,
        year: null,
        vin: null,
        licensePlate: null,
      }),
    ).toEqual({ device: "", carNumber: "", vin: "" });
  });

  it("returns empty snapshots when no vehicle is selected", () => {
    expect(orderAssetFieldsFromVehicle(null)).toEqual({ device: "", carNumber: "", vin: "" });
    expect(orderAssetFieldsFromVehicle(undefined)).toEqual({ device: "", carNumber: "", vin: "" });
  });
});
