import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("../vehicles/VehicleDetailPanel", () => ({
  VehicleDetailPanel: ({
    open,
    vehicleId,
  }: {
    open: boolean;
    vehicleId: string | null;
  }) => (open ? <div data-testid="vehicle-detail-panel">vehicle:{vehicleId}</div> : null),
}));

vi.mock("../clients/ClientDetailsHost", () => ({
  ClientDetailsHost: () => null,
}));

vi.mock("../clients/useOpenClientDetails", () => ({
  useOpenClientDetails: () => ({
    selectedClient: null,
    detailPanelOpen: false,
    setDetailPanelOpen: vi.fn(),
    openClient: vi.fn(),
    onClientUpdated: vi.fn(),
  }),
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
  mileageUnit: null,
  engineDisplacement: 1.8,
  fuelType: "petrol",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

describe("OrderLinkedVehicleDetails", () => {
  const onOpenRelatedOrder = vi.fn();

  beforeEach(() => {
    vehicleState.vehicle = fullVehicle;
    vehicleState.isLoading = false;
    vehicleState.isError = false;
    vehicleState.notFound = false;
    onOpenRelatedOrder.mockReset();
  });

  it("renders nothing when the order has no vehicle_id", () => {
    const { container } = renderWithQuery(
      <OrderLinkedVehicleDetails
        vehicleId={null}
        vehicleMileageSnapshot={null}
        vehicleMileageUnitSnapshot={null}
        onOpenRelatedOrder={onOpenRelatedOrder}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("order-linked-vehicle")).not.toBeInTheDocument();
  });

  it("loads vehicle identity from the vehicle and visit mileage from the order snapshot", () => {
    renderWithQuery(
      <OrderLinkedVehicleDetails
        vehicleId="veh-1"
        vehicleMileageSnapshot={85500}
        vehicleMileageUnitSnapshot="mi"
        onOpenRelatedOrder={onOpenRelatedOrder}
      />,
    );

    expect(screen.getByTestId("order-linked-vehicle")).toBeInTheDocument();
    expect(screen.getByText("Make")).toBeInTheDocument();
    expect(screen.getByText("Toyota")).toBeInTheDocument();
    expect(screen.getByText("Corolla")).toBeInTheDocument();
    expect(screen.getByText("2018")).toBeInTheDocument();
    expect(screen.getByText("1HGBH41JXMN109186")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.getByText(/10,?000/)).toBeInTheDocument();
    // Visit unit is inlined on the current-mileage value; the separate unit row is hidden on order cards.
    expect(screen.getByText(/85,?500 mi/)).toBeInTheDocument();
    expect(screen.getByText("1.8")).toBeInTheDocument();
    expect(screen.getByText("Petrol")).toBeInTheDocument();
    expect(screen.queryByText("Visit mileage unit")).not.toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
  });

  it("keeps the order snapshot unit when the vehicle live unit differs", () => {
    vehicleState.vehicle = { ...fullVehicle, mileageUnit: "km", currentMileage: 99999 };
    renderWithQuery(
      <OrderLinkedVehicleDetails
        vehicleId="veh-1"
        vehicleMileageSnapshot={85500}
        vehicleMileageUnitSnapshot="mi"
        onOpenRelatedOrder={onOpenRelatedOrder}
      />,
    );

    expect(screen.getByText(/85,?500 mi/)).toBeInTheDocument();
    expect(screen.queryByText(/99,?999/)).not.toBeInTheDocument();
    expect(screen.queryByText(/85,?500 km/)).not.toBeInTheDocument();
  });

  it("shows unknown unit for legacy orders without a historical unit", () => {
    renderWithQuery(
      <OrderLinkedVehicleDetails
        vehicleId="veh-1"
        vehicleMileageSnapshot={12000}
        vehicleMileageUnitSnapshot={null}
        onOpenRelatedOrder={onOpenRelatedOrder}
      />,
    );

    expect(screen.getByText(/12,?000 \(unit\?\)/i)).toBeInTheDocument();
  });

  it("opens vehicle details in a side drawer instead of navigating", async () => {
    const user = userEvent.setup();
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-1" onOpenRelatedOrder={onOpenRelatedOrder} />);

    expect(screen.queryByTestId("vehicle-detail-panel")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View vehicle details" }));
    expect(screen.getByTestId("vehicle-detail-panel")).toHaveTextContent("vehicle:veh-1");
    expect(screen.queryByRole("link", { name: "View vehicle details" })).not.toBeInTheDocument();
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
      mileageUnit: null,
      engineDisplacement: null,
      fuelType: null,
    };
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-1" onOpenRelatedOrder={onOpenRelatedOrder} />);

    const dashes = screen.getAllByText("—");
    // make, model, year, vin, plate, mileage unit, initial, current, engine, fuel
    expect(dashes.length).toBeGreaterThanOrEqual(9);
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("surfaces load failures without substituting another vehicle", () => {
    vehicleState.vehicle = null;
    vehicleState.isError = true;
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-1" onOpenRelatedOrder={onOpenRelatedOrder} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load vehicles/i);
    expect(screen.queryByText("Toyota")).not.toBeInTheDocument();
  });

  it("surfaces a missing vehicle without falling back to order columns", () => {
    vehicleState.vehicle = null;
    vehicleState.notFound = true;
    renderWithQuery(<OrderLinkedVehicleDetails vehicleId="veh-missing" onOpenRelatedOrder={onOpenRelatedOrder} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not found|permission/i);
  });
});
