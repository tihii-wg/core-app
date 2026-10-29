import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Vehicle } from "../../lib/types";
import { OrderLinkedVehicleDetails } from "./OrderLinkedVehicleDetails";

const vehicleState = vi.hoisted(() => ({
  vehicle: null as Vehicle | null,
  isLoading: false,
  isError: false,
  notFound: false,
}));

vi.mock("../vehicles/useGetVehicle", () => ({
  useGetVehicle: () => ({
    vehicle: vehicleState.vehicle,
    isLoading: vehicleState.isLoading,
    isFetching: false,
    isError: vehicleState.isError,
    error: vehicleState.isError ? new Error("network") : null,
    notFound: vehicleState.notFound,
    refetch: vi.fn(),
  }),
  vehicleQueryKey: (workspaceId: string | undefined, vehicleId: string) => ["vehicles", workspaceId, "id", vehicleId],
}));

const fullVehicle: Vehicle = {
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
  engineDisplacement: 1.8,
  fuelType: "petrol",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

describe("OrderLinkedVehicleDetails", () => {
  beforeEach(() => {
    vehicleState.vehicle = fullVehicle;
    vehicleState.isLoading = false;
    vehicleState.isError = false;
    vehicleState.notFound = false;
  });

  it("renders nothing when the order has no vehicle_id", () => {
    const { container } = renderWithQuery(<OrderLinkedVehicleDetails vehicleId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("order-linked-vehicle")).not.toBeInTheDocument();
  });

  it("loads all vehicle fields from the associated vehicle record", () => {
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-1" />);

    expect(screen.getByTestId("order-linked-vehicle")).toBeInTheDocument();
    expect(screen.getByText("Make")).toBeInTheDocument();
    expect(screen.getByText("Toyota")).toBeInTheDocument();
    expect(screen.getByText("Corolla")).toBeInTheDocument();
    expect(screen.getByText("2018")).toBeInTheDocument();
    expect(screen.getByText("1HGBH41JXMN109186")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.getByText("10000")).toBeInTheDocument();
    expect(screen.getByText("45200")).toBeInTheDocument();
    expect(screen.getByText("1.8")).toBeInTheDocument();
    expect(screen.getByText("Petrol")).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
  });

  it("shows the empty-value dash for missing vehicle fields", () => {
    vehicleState.vehicle = {
      ...fullVehicle,
      make: null,
      model: null,
      year: null,
      vin: null,
      licensePlate: null,
      initialMileage: null,
      currentMileage: null,
      engineDisplacement: null,
      fuelType: null,
    };
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-1" />);

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(9);
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("surfaces load failures without substituting another vehicle", () => {
    vehicleState.vehicle = null;
    vehicleState.isError = true;
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load vehicles/i);
    expect(screen.queryByText("Toyota")).not.toBeInTheDocument();
  });

  it("surfaces a missing vehicle without falling back to order columns", () => {
    vehicleState.vehicle = null;
    vehicleState.notFound = true;
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-missing" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not found|permission/i);
  });
});
