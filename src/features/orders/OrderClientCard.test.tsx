import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { industryWorkflow } from "../industries/industryWorkflow";
import { OrderClientCard } from "./OrderClientCard";

vi.mock("../vehicles/useGetVehicle", () => ({
  useGetVehicle: () => ({
    vehicle: {
      id: "v-1",
      make: "Toyota",
      model: "Camry",
      year: 2018,
      licensePlate: "ABC123",
      vin: "VIN12345678901234",
    },
    isLoading: false,
    isError: false,
    notFound: false,
  }),
}));

function order(partial: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    clientId: "client-1",
    clientName: "Ada Lovelace",
    clientType: "individual",
    clientPhone: "+37360000000",
    orderNumber: "ORD-1",
    vehicleId: "v-1",
    device: "Phone X",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 100,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  } as Order;
}

describe("OrderClientCard", () => {
  it("is clickable when interactive and opens change on click", async () => {
    const user = userEvent.setup();
    const onChangeRequest = vi.fn();
    renderWithQuery(
      <OrderClientCard
        order={order()}
        workflow={industryWorkflow("auto_repair")}
        deviceLabel="Device"
        carNumberLabel="Plate"
        vinLabel="VIN"
        interactive
        onChangeRequest={onChangeRequest}
        onOpenClient={vi.fn()}
      />,
    );

    const card = screen.getByTestId("order-client-card");
    expect(card).toHaveAttribute("role", "button");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByTestId("order-client-card-vehicle")).toBeInTheDocument();
    await user.click(card);
    expect(onChangeRequest).toHaveBeenCalled();
  });

  it("is read-only when not interactive and still opens the client link", async () => {
    const user = userEvent.setup();
    const onChangeRequest = vi.fn();
    const onOpenClient = vi.fn();
    renderWithQuery(
      <OrderClientCard
        order={order()}
        workflow={industryWorkflow("auto_repair")}
        deviceLabel="Device"
        carNumberLabel="Plate"
        vinLabel="VIN"
        interactive={false}
        onChangeRequest={onChangeRequest}
        onOpenClient={onOpenClient}
      />,
    );

    expect(screen.getByTestId("order-client-card")).not.toHaveAttribute("role", "button");
    await user.click(screen.getByTestId("order-client-card-open-client"));
    expect(onOpenClient).toHaveBeenCalledWith("client-1");
    expect(onChangeRequest).not.toHaveBeenCalled();
  });

  it("shows asset summary for non-vehicle industries (no vehicle block)", () => {
    renderWithQuery(
      <OrderClientCard
        order={order({ vehicleId: null, device: "Sofa set", carNumber: "", vin: "" })}
        workflow={industryWorkflow("furniture_manufacturing")}
        deviceLabel="Object"
        carNumberLabel="Plate"
        vinLabel="VIN"
        interactive
        onChangeRequest={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("order-client-card-vehicle")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-client-card-asset")).toHaveTextContent(/Sofa set/);
  });

  it("shows add-client affordance when the order has no client", () => {
    renderWithQuery(
      <OrderClientCard
        order={order({ clientId: "", clientName: "", vehicleId: null })}
        workflow={industryWorkflow("auto_repair")}
        deviceLabel="Device"
        carNumberLabel="Plate"
        vinLabel="VIN"
        interactive
        onChangeRequest={vi.fn()}
      />,
    );

    expect(screen.getByText(/\+ Add client/i)).toBeInTheDocument();
  });
});
