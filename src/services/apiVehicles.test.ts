import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vehicle } from "../lib/types";
import {
  assertVehicleAssignable,
  createVehicle,
  orderAssetFieldsFromVehicle,
  resetVehicleMileageUnitSupport,
  searchVehiclesByRegistration,
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

describe("searchVehiclesByRegistration", () => {
  beforeEach(() => {
    from.mockReset();
  });

  function vehicleRow(overrides: Record<string, unknown>) {
    return {
      workspace_id: "ws-1",
      year: null,
      vin: null,
      initial_mileage: null,
      current_mileage: null,
      engine_displacement: null,
      fuel_type: null,
      created_at: "",
      updated_at: "",
      deleted_at: null,
      ...overrides,
    };
  }

  function mockVehicleSearch(rows: Record<string, unknown>[], clients: Record<string, unknown>[], capture?: { orFilters: string[]; isArgs: unknown[][] }) {
    const vehicleChain: Record<string, unknown> = {};
    vehicleChain.select = () => vehicleChain;
    vehicleChain.eq = () => vehicleChain;
    vehicleChain.is = (...args: unknown[]) => {
      capture?.isArgs.push(args);
      return vehicleChain;
    };
    vehicleChain.or = (filter: string) => {
      capture?.orFilters.push(filter);
      return vehicleChain;
    };
    vehicleChain.order = () => vehicleChain;
    vehicleChain.limit = () => Promise.resolve({ data: rows, error: null });

    const clientsChain: Record<string, unknown> = {};
    clientsChain.select = () => clientsChain;
    clientsChain.eq = () => clientsChain;
    clientsChain.is = () => clientsChain;
    clientsChain.in = () => Promise.resolve({ data: clients, error: null });

    from.mockImplementation((table: string) => (table === "vehicles" ? vehicleChain : clientsChain));
  }

  it("returns workspace vehicles whose plates match after normalization, with owning clients", async () => {
    mockVehicleSearch(
      [
        vehicleRow({
          id: "veh-1",
          client_id: "client-1",
          make: "Toyota",
          model: "Corolla",
          year: 2018,
          license_plate: "B 123 ABC",
        }),
        vehicleRow({
          id: "veh-skip",
          client_id: "client-1",
          make: "Other",
          model: "Car",
          year: 2010,
          license_plate: "ZZZ999",
        }),
      ],
      [
        {
          id: "client-1",
          name: "Ada",
          email: "",
          phone: "",
          address: "",
          balance: 0,
          created_at: "",
          client_type: "individual",
          tax_id: null,
          contact_person: null,
        },
      ],
    );

    const hits = await searchVehiclesByRegistration("ws-1", "b123abc");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual(
      expect.objectContaining({
        vehicleId: "veh-1",
        licensePlate: "B 123 ABC",
        client: expect.objectContaining({ id: "client-1", name: "Ada" }),
      }),
    );
    expect(from).toHaveBeenCalledWith("vehicles");
    expect(from).toHaveBeenCalledWith("clients");
  });

  it("matches vehicles by make, model, and combined make/model", async () => {
    const capture = { orFilters: [] as string[], isArgs: [] as unknown[][] };
    mockVehicleSearch(
      [
        vehicleRow({
          id: "veh-bmw",
          client_id: "client-bmw",
          make: "BMW",
          model: "X5",
          license_plate: "B 111 BMW",
        }),
        vehicleRow({
          id: "veh-camry",
          client_id: "client-toyota",
          make: "Toyota",
          model: "Camry",
          license_plate: null,
        }),
        vehicleRow({
          id: "veh-other",
          client_id: "client-other",
          make: "Audi",
          model: "A4",
          license_plate: "AA 1",
        }),
      ],
      [
        {
          id: "client-bmw",
          name: "BMW Owner",
          email: "",
          phone: "",
          address: "",
          balance: 0,
          created_at: "",
          client_type: "individual",
          tax_id: null,
          contact_person: null,
        },
        {
          id: "client-toyota",
          name: "Camry Owner",
          email: "",
          phone: "",
          address: "",
          balance: 0,
          created_at: "",
          client_type: "individual",
          tax_id: null,
          contact_person: null,
        },
      ],
      capture,
    );

    const byMake = await searchVehiclesByRegistration("ws-1", "BMW");
    expect(byMake.map((hit) => hit.vehicleId)).toEqual(["veh-bmw"]);
    expect(capture.orFilters[0]).toContain("make.ilike.%BMW%");
    expect(capture.isArgs).toContainEqual(["deleted_at", null]);

    capture.orFilters.length = 0;
    const byModel = await searchVehiclesByRegistration("ws-1", "Camry");
    expect(byModel).toEqual([
      expect.objectContaining({
        vehicleId: "veh-camry",
        licensePlate: "",
        make: "Toyota",
        model: "Camry",
        client: expect.objectContaining({ id: "client-toyota" }),
      }),
    ]);

    const byCombo = await searchVehiclesByRegistration("ws-1", "Toyota Camry");
    expect(byCombo.map((hit) => hit.vehicleId)).toEqual(["veh-camry"]);
  });

  it("returns separate hits when multiple vehicles match the same make", async () => {
    mockVehicleSearch(
      [
        vehicleRow({
          id: "veh-1",
          client_id: "client-1",
          make: "BMW",
          model: "X5",
          license_plate: "B1",
        }),
        vehicleRow({
          id: "veh-2",
          client_id: "client-1",
          make: "BMW",
          model: "X3",
          license_plate: "B2",
        }),
      ],
      [
        {
          id: "client-1",
          name: "Fleet",
          email: "",
          phone: "",
          address: "",
          balance: 0,
          created_at: "",
          client_type: "individual",
          tax_id: null,
          contact_person: null,
        },
      ],
    );

    const hits = await searchVehiclesByRegistration("ws-1", "BMW");
    expect(hits.map((hit) => hit.vehicleId).sort()).toEqual(["veh-1", "veh-2"]);
  });

  it("returns an empty list for short queries without hitting the database", async () => {
    await expect(searchVehiclesByRegistration("ws-1", "B")).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
