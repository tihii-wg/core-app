import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Vehicle } from "../../lib/types";
import {
  buildOrderMileageSnapshot,
  isIntakeMileageBelowKnown,
  knownVehicleMileage,
  mileageFormValueFromOrder,
  mileageFormValueFromVehicle,
  parseVisitMileage,
  persistOrderVehicleMileage,
  resolveCloseMileagePrefill,
  resolveVehicleMileageUpdate,
  shouldConfirmMileageBeforeClose,
  vehicleInputWithCurrentMileage,
  visitMileageValidate,
} from "./orderVehicleMileage";
import type { Order } from "../../lib/types";

const updateVehicleMock = vi.hoisted(() => vi.fn());

vi.mock("../../i18n", () => ({
  default: {
    t: (key: string) => key,
  },
  currentIntlLocale: () => "en-US",
}));

vi.mock("../../services/apiVehicles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiVehicles")>();
  return {
    ...actual,
    updateVehicle: (...args: unknown[]) => updateVehicleMock(...args),
  };
});

const vehicle: Vehicle = {
  id: "veh-1",
  workspaceId: "ws-1",
  clientId: "client-1",
  make: "Toyota",
  model: "Corolla",
  year: 2018,
  vin: "1HGBH41JXMN109186",
  licensePlate: "ABC123",
  initialMileage: 1000,
  currentMileage: 45000,
  mileageUnit: null,
  engineDisplacement: null,
  fuelType: null,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

describe("orderVehicleMileage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses whole non-negative mileage and rejects decimals/negatives", () => {
    expect(parseVisitMileage("")).toBeNull();
    expect(parseVisitMileage("  ")).toBeNull();
    expect(parseVisitMileage("0")).toBe(0);
    expect(parseVisitMileage("45200")).toBe(45200);
    expect(parseVisitMileage("120 500")).toBe(120_500);
    expect(() => parseVisitMileage("-1")).toThrow(/mileageInvalid/);
    expect(() => parseVisitMileage("12.5")).toThrow(/mileageInvalid/);
    expect(() => parseVisitMileage("abc")).toThrow(/mileageInvalid/);
  });

  it("validates form values without requiring a value", () => {
    expect(visitMileageValidate("", "bad")).toBe(true);
    expect(visitMileageValidate("100", "bad")).toBe(true);
    expect(visitMileageValidate("120 500", "bad")).toBe(true);
    expect(visitMileageValidate("-3", "bad")).toMatch(/mileageInvalid/);
    expect(visitMileageValidate("1.2", "bad")).toMatch(/mileageInvalid/);
  });

  it("does not clear existing mileage when the form value is empty", () => {
    expect(resolveVehicleMileageUpdate(vehicle, "")).toEqual({ update: false });
    expect(resolveVehicleMileageUpdate(vehicle, "   ")).toEqual({ update: false });
  });

  it("skips update when mileage is unchanged", () => {
    expect(resolveVehicleMileageUpdate(vehicle, "45000")).toEqual({ update: false });
  });

  it("updates when the user enters a new mileage", () => {
    expect(resolveVehicleMileageUpdate(vehicle, "46000")).toEqual({ update: true, currentMileage: 46000 });
    expect(resolveVehicleMileageUpdate({ ...vehicle, currentMileage: null }, "100")).toEqual({
      update: true,
      currentMileage: 100,
    });
  });

  it("builds a vehicle input that only changes currentMileage", () => {
    expect(vehicleInputWithCurrentMileage(vehicle, 46000)).toEqual({
      make: "Toyota",
      model: "Corolla",
      year: 2018,
      vin: "1HGBH41JXMN109186",
      licensePlate: "ABC123",
      initialMileage: 1000,
      currentMileage: 46000,
      engineDisplacement: null,
      fuelType: null,
    });
    expect(vehicleInputWithCurrentMileage(vehicle, 46000)).not.toHaveProperty("mileageUnit");
  });

  it("persists mileage through updateVehicle and skips empty values", async () => {
    updateVehicleMock.mockResolvedValue({ ...vehicle, currentMileage: 46000 });
    const queryClient = { invalidateQueries: vi.fn() } as unknown as QueryClient;

    await expect(
      persistOrderVehicleMileage({
        workspaceId: "ws-1",
        clientId: "client-1",
        vehicle,
        formMileage: "",
        queryClient,
      }),
    ).resolves.toBeNull();
    expect(updateVehicleMock).not.toHaveBeenCalled();

    await persistOrderVehicleMileage({
      workspaceId: "ws-1",
      clientId: "client-1",
      vehicle,
      formMileage: "46000",
      queryClient,
    });
    expect(updateVehicleMock).toHaveBeenCalledWith(
      "ws-1",
      "veh-1",
      expect.objectContaining({ currentMileage: 46000 }),
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it("surfaces updateVehicle failures", async () => {
    updateVehicleMock.mockRejectedValue(new Error("rlss blocked"));
    const queryClient = { invalidateQueries: vi.fn() } as unknown as QueryClient;

    await expect(
      persistOrderVehicleMileage({
        workspaceId: "ws-1",
        clientId: "client-1",
        vehicle,
        formMileage: "46000",
        queryClient,
      }),
    ).rejects.toThrow(/rlss blocked/);
  });

  it("builds an order miles snapshot from visit mileage and the vehicle unit", () => {
    expect(buildOrderMileageSnapshot("85500", { mileageUnit: "mi" })).toEqual({
      vehicleMileageSnapshot: 85500,
      vehicleMileageUnitSnapshot: "mi",
    });
    expect(buildOrderMileageSnapshot("1200", { mileageUnit: "km" })).toEqual({
      vehicleMileageSnapshot: 1200,
      vehicleMileageUnitSnapshot: "km",
    });
    expect(buildOrderMileageSnapshot("100", { mileageUnit: null })).toEqual({
      vehicleMileageSnapshot: 100,
      vehicleMileageUnitSnapshot: null,
    });
    expect(buildOrderMileageSnapshot("", { mileageUnit: "mi" })).toBeNull();
  });

  it("prefills edit forms from the order snapshot, not the live vehicle reading", () => {
    expect(mileageFormValueFromOrder({ vehicleMileageSnapshot: 85500 })).toMatch(/85[\s,]?500/);
    expect(mileageFormValueFromOrder({ vehicleMileageSnapshot: null })).toBe("");
    expect(mileageFormValueFromOrder(undefined)).toBe("");
  });

  it("updates vehicle current mileage from grouped visit input", () => {
    expect(resolveVehicleMileageUpdate(vehicle, "120 500")).toEqual({
      update: true,
      currentMileage: 120_500,
    });
  });

  it("prefills from current ?? initial and compares below-known with unit conversion", () => {
    expect(knownVehicleMileage({ currentMileage: null, initialMileage: 9000 })).toBe(9000);
    expect(mileageFormValueFromVehicle({ ...vehicle, currentMileage: null, initialMileage: 9000 })).toMatch(
      /9[\s,]?000/,
    );
    // 12_000 mi ≈ 19_312 km — not below a 19_000 km known reading? use 18_000 known → below.
    expect(
      isIntakeMileageBelowKnown({
        reading: 12_000,
        readingUnit: "mi",
        vehicle: { ...vehicle, currentMileage: 19_000, mileageUnit: "km" },
      }),
    ).toBe(false);
    // 10_000 mi ≈ 16_093 km which is below a 50_000 km known reading.
    expect(
      isIntakeMileageBelowKnown({
        reading: 10_000,
        readingUnit: "mi",
        vehicle: { ...vehicle, currentMileage: 50_000, mileageUnit: "km" },
      }),
    ).toBe(true);
  });

  it("gates the soft close dialog only for vehicle industries with mileage warranties", () => {
    const base = {
      id: "o1",
      clientId: "c1",
      clientName: "A",
      orderNumber: "1",
      device: "",
      vin: "",
      carNumber: "",
      service: "",
      services: [{ id: "s1", serviceName: "Oil", price: 1, quantity: 1, warrantyKm: 10000 }],
      materials: [],
      description: "",
      status: "in-progress",
      totalPrice: 1,
      isPaid: false,
      createdAt: "",
      vehicleId: "veh-1",
      vehicleMileageConfirmed: false,
    } as unknown as Order;

    expect(shouldConfirmMileageBeforeClose(base, { clientVehicles: true })).toBe(true);
    expect(shouldConfirmMileageBeforeClose(base, { clientVehicles: false })).toBe(false);
    expect(
      shouldConfirmMileageBeforeClose({ ...base, vehicleMileageConfirmed: true }, { clientVehicles: true }),
    ).toBe(false);
    expect(shouldConfirmMileageBeforeClose({ ...base, vehicleId: null }, { clientVehicles: true })).toBe(false);
    expect(
      shouldConfirmMileageBeforeClose(
        {
          ...base,
          services: [{ id: "s1", serviceName: "Oil", price: 1, quantity: 1, warrantyKm: null }] as Order["services"],
        },
        { clientVehicles: true },
      ),
    ).toBe(false);

    expect(
      resolveCloseMileagePrefill({
        order: { vehicleMileageSnapshot: null, vehicleMileageUnitSnapshot: null },
        vehicle: { currentMileage: null, initialMileage: 12000, mileageUnit: "mi" },
      }),
    ).toEqual({ value: 12000, unit: "mi" });
  });
});
