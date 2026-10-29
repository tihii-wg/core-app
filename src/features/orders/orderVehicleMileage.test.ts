import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Vehicle } from "../../lib/types";
import {
  parseVisitMileage,
  persistOrderVehicleMileage,
  resolveVehicleMileageUpdate,
  vehicleInputWithCurrentMileage,
  visitMileageValidate,
} from "./orderVehicleMileage";

const updateVehicleMock = vi.hoisted(() => vi.fn());

vi.mock("../../i18n", () => ({
  default: {
    t: (key: string) => key,
  },
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
    expect(() => parseVisitMileage("-1")).toThrow(/mileageWholeNonNegative/);
    expect(() => parseVisitMileage("12.5")).toThrow(/mileageWholeNonNegative/);
    expect(() => parseVisitMileage("abc")).toThrow(/mileageWholeNonNegative/);
  });

  it("validates form values without requiring a value", () => {
    expect(visitMileageValidate("", "bad")).toBe(true);
    expect(visitMileageValidate("100", "bad")).toBe(true);
    expect(visitMileageValidate("-3", "bad")).toBe("bad");
    expect(visitMileageValidate("1.2", "bad")).toBe("bad");
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
});
