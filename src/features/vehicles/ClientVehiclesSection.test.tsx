import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Vehicle } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { ClientVehiclesSection } from "./ClientVehiclesSection";

const vehiclesState = vi.hoisted(() => ({
  vehicles: [] as Vehicle[],
}));

vi.mock("./useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({ vehicles: vehiclesState.vehicles, isLoading: false, isError: false }),
  clientVehiclesQueryKey: (workspaceId: string | undefined, clientId: string) => ["vehicles", workspaceId, clientId],
}));

vi.mock("./useVehicleMutations", () => ({
  useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("./VehicleDetailPanel", () => ({
  VehicleDetailPanel: ({
    open,
    vehicleId,
  }: {
    open: boolean;
    vehicleId: string | null;
  }) => (open ? <div data-testid="vehicle-detail-panel">vehicle:{vehicleId}</div> : null),
}));

const sampleVehicle: Vehicle = {
  id: "veh-1",
  workspaceId: "ws-1",
  clientId: "client-1",
  make: "Toyota",
  model: "Corolla",
  year: 2018,
  vin: "1HGBH41JXMN109186",
  licensePlate: "ABC123",
  initialMileage: 10000,
  currentMileage: 45200,
  mileageUnit: null,
  engineDisplacement: 1.8,
  fuelType: "petrol",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

describe("ClientVehiclesSection", () => {
  it("shows an empty state and add action when the client has no vehicles", () => {
    vehiclesState.vehicles = [];
    renderWithQuery(<ClientVehiclesSection clientId="client-1" />);

    expect(screen.getByText("No vehicles found")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add vehicle" }).length).toBeGreaterThan(0);
  });

  it("lists vehicles and opens the vehicle details drawer without navigating", async () => {
    vehiclesState.vehicles = [
      sampleVehicle,
      { ...sampleVehicle, id: "veh-2", make: "VW", model: "Golf", year: 2020, vin: null, licensePlate: "XYZ999", currentMileage: 12000 },
    ];
    const user = userEvent.setup();
    renderWithQuery(<ClientVehiclesSection clientId="client-1" />);

    const first = screen.getByRole("button", { name: /Toyota Corolla 2018/i });
    expect(first).toHaveTextContent("VIN: 1HGBH41JXMN109186");
    expect(first).toHaveTextContent("License plate: ABC123");
    expect(first).toHaveTextContent(/Current odometer reading: 45,?200/);
    expect(screen.queryByTestId("vehicle-detail-panel")).not.toBeInTheDocument();

    await user.click(first);
    expect(screen.getByTestId("vehicle-detail-panel")).toHaveTextContent("vehicle:veh-1");
    expect(screen.queryByRole("link", { name: /Toyota Corolla 2018/i })).not.toBeInTheDocument();
  });

  it("keeps edit and archive actions available beside the vehicle button", async () => {
    vehiclesState.vehicles = [sampleVehicle];
    const user = userEvent.setup();
    renderWithQuery(<ClientVehiclesSection clientId="client-1" />);

    await user.click(screen.getByRole("button", { name: "Edit vehicle" }));
    expect(screen.getByRole("heading", { name: "Edit vehicle" })).toBeInTheDocument();
  });

  it("calls onCreateOrder with the exact vehicle id for each row", async () => {
    vehiclesState.vehicles = [
      sampleVehicle,
      { ...sampleVehicle, id: "veh-2", make: "VW", model: "Golf", year: 2020, vin: null, licensePlate: "XYZ999", currentMileage: 12000 },
    ];
    const onCreateOrder = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<ClientVehiclesSection clientId="client-1" onCreateOrder={onCreateOrder} />);

    await user.click(screen.getByRole("button", { name: /Create order for Toyota Corolla 2018/i }));
    expect(onCreateOrder).toHaveBeenCalledExactlyOnceWith("veh-1");

    onCreateOrder.mockClear();
    await user.click(screen.getByRole("button", { name: /Create order for VW Golf 2020/i }));
    expect(onCreateOrder).toHaveBeenCalledExactlyOnceWith("veh-2");
  });

  it("hides per-vehicle Create Order when the callback is omitted", () => {
    vehiclesState.vehicles = [sampleVehicle];
    renderWithQuery(<ClientVehiclesSection clientId="client-1" />);
    expect(screen.queryByRole("button", { name: /Create order for/i })).not.toBeInTheDocument();
  });
});
