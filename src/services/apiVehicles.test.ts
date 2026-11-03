import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vehicle } from "../lib/types";
import {
  assertVehicleAssignable,
  createVehicle,
  orderAssetFieldsFromVehicle,
  resetVehicleMileageUnitSupport,
  toVehicle,
  updateVehicle,
  vehicleMakeModelLabel,
} from "./apiVehicles";

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

function writeQuery(result: { data: unknown; error: unknown }, terminal: "single" | "maybeSingle" = "single") {
  const chain: Record<string, unknown> = {};
  const selectArgs: unknown[] = [];
  const insertArgs: unknown[] = [];
  const updateArgs: unknown[] = [];
  chain.insert = (payload: unknown) => {
    insertArgs.push(payload);
    return chain;
  };
  chain.update = (payload: unknown) => {
    updateArgs.push(payload);
    return chain;
  };
  chain.select = (cols?: unknown) => {
    selectArgs.push(cols);
    return chain;
  };
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.single = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  return { chain, selectArgs, insertArgs, updateArgs, terminal };
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
    mileageUnit: null,
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

describe("vehicle mileage_unit mapping", () => {
  beforeEach(() => {
    from.mockReset();
    resetVehicleMileageUnitSupport();
  });

  it("maps mileage_unit from DB rows without inventing a unit", () => {
    expect(toVehicle({ id: "1", workspace_id: "ws", client_id: "c", mileage_unit: "km" }).mileageUnit).toBe("km");
    expect(toVehicle({ id: "1", workspace_id: "ws", client_id: "c", mileage_unit: "mi" }).mileageUnit).toBe("mi");
    expect(toVehicle({ id: "1", workspace_id: "ws", client_id: "c", mileage_unit: null }).mileageUnit).toBeNull();
    expect(toVehicle({ id: "1", workspace_id: "ws", client_id: "c" }).mileageUnit).toBeNull();
  });

  it("persists selected mileage_unit on create and reloads it", async () => {
    const clientCheck = maybeSingleQuery({ data: { id: "client-1" }, error: null });
    const write = writeQuery({
      data: {
        id: "veh-1",
        workspace_id: "ws-1",
        client_id: "client-1",
        make: "Toyota",
        model: null,
        year: null,
        vin: null,
        license_plate: null,
        initial_mileage: null,
        current_mileage: 12000,
        mileage_unit: "mi",
        engine_displacement: null,
        fuel_type: null,
        created_at: "",
        updated_at: "",
        deleted_at: null,
      },
      error: null,
    });
    from.mockImplementation((table: string) => (table === "clients" ? clientCheck : write.chain));

    const created = await createVehicle("ws-1", "client-1", {
      make: "Toyota",
      currentMileage: 12000,
      mileageUnit: "mi",
    });

    expect(write.insertArgs[0]).toEqual(
      expect.objectContaining({
        mileage_unit: "mi",
        current_mileage: 12000,
      }),
    );
    expect(String(write.selectArgs[0])).toContain("mileage_unit");
    expect(created.mileageUnit).toBe("mi");
    expect(created.currentMileage).toBe(12000);
  });

  it("updates mileage_unit later without converting current_mileage", async () => {
    const write = writeQuery(
      {
        data: {
          id: "veh-1",
          workspace_id: "ws-1",
          client_id: "client-1",
          make: "Toyota",
          model: null,
          year: null,
          vin: null,
          license_plate: null,
          initial_mileage: null,
          current_mileage: 45200,
          mileage_unit: "mi",
          engine_displacement: null,
          fuel_type: null,
          created_at: "",
          updated_at: "",
          deleted_at: null,
        },
        error: null,
      },
      "maybeSingle",
    );
    from.mockReturnValue(write.chain);

    const updated = await updateVehicle("ws-1", "veh-1", {
      make: "Toyota",
      currentMileage: 45200,
      mileageUnit: "mi",
    });

    expect(write.updateArgs[0]).toEqual(
      expect.objectContaining({
        mileage_unit: "mi",
        current_mileage: 45200,
      }),
    );
    expect(updated.mileageUnit).toBe("mi");
    expect(updated.currentMileage).toBe(45200);
  });

  it("omits mileage_unit from the payload when the caller does not provide it", async () => {
    const write = writeQuery(
      {
        data: {
          id: "veh-1",
          workspace_id: "ws-1",
          client_id: "client-1",
          make: "Toyota",
          model: null,
          year: null,
          vin: null,
          license_plate: null,
          initial_mileage: null,
          current_mileage: 46000,
          mileage_unit: "km",
          engine_displacement: null,
          fuel_type: null,
          created_at: "",
          updated_at: "",
          deleted_at: null,
        },
        error: null,
      },
      "maybeSingle",
    );
    from.mockReturnValue(write.chain);

    await updateVehicle("ws-1", "veh-1", {
      make: "Toyota",
      currentMileage: 46000,
    });

    expect(write.updateArgs[0]).not.toHaveProperty("mileage_unit");
    expect(write.updateArgs[0]).toEqual(expect.objectContaining({ current_mileage: 46000 }));
  });
});
