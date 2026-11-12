import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Order, Vehicle } from "../../lib/types";
import { ConfirmOrderMileageDialog } from "./ConfirmOrderMileageDialog";

const order = {
  id: "o1",
  clientId: "c1",
  clientName: "Client",
  orderNumber: "ORD-1",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  materials: [],
  description: "",
  status: "in-progress",
  totalPrice: 100,
  isPaid: false,
  createdAt: "",
  vehicleId: "veh-1",
  vehicleMileageSnapshot: 45000,
  vehicleMileageUnitSnapshot: "km",
  vehicleMileageConfirmed: false,
} as unknown as Order;

const vehicle = {
  id: "veh-1",
  workspaceId: "ws-1",
  clientId: "c1",
  make: "Toyota",
  model: "Corolla",
  year: 2018,
  vin: null,
  licensePlate: null,
  initialMileage: 1000,
  currentMileage: 45000,
  mileageUnit: "km",
  engineDisplacement: null,
  fuelType: null,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
} as Vehicle;

describe("ConfirmOrderMileageDialog", () => {
  it("offers close without changes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmOrderMileageDialog
        open
        order={order}
        vehicle={vehicle}
        onOpenChange={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("confirm-order-mileage-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-order-mileage-input")).toHaveValue("45,000");

    await user.click(screen.getByTestId("confirm-order-mileage-skip"));
    expect(onConfirm).toHaveBeenCalledWith({ action: "skip" });
  });

  it("offers save mileage and close", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmOrderMileageDialog
        open
        order={order}
        vehicle={vehicle}
        onOpenChange={() => undefined}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByTestId("confirm-order-mileage-save"));
    expect(onConfirm).toHaveBeenCalledWith({
      action: "save",
      mileage: 45000,
      unit: "km",
    });
  });

  it("shows time-only warranty copy when mileage is missing", () => {
    render(
      <ConfirmOrderMileageDialog
        open
        order={{ ...order, vehicleMileageSnapshot: null }}
        vehicle={{ ...vehicle, currentMileage: null, initialMileage: null }}
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByText(/warranty will apply by time only|только по времени|doar pe timp/i)).toBeInTheDocument();
  });
});
