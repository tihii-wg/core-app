import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";

const changeMutate = vi.hoisted(() => vi.fn());
const clientsState = vi.hoisted(() => ({
  clients: [] as Client[],
}));
const vehiclesState = vi.hoisted(() => ({
  vehicles: [] as Array<{ id: string; make: string; model: string; licensePlate: string; vin: string; year: number | null }>,
}));
const discountsState = vi.hoisted(() => ({
  rows: [] as unknown[],
}));
const industryState = vi.hoisted(() => ({
  slug: "auto_repair" as string,
}));

vi.mock("./useChangeOrderClient", () => ({
  useChangeOrderClient: () => ({
    mutateAsync: changeMutate,
    isPending: false,
  }),
}));

vi.mock("../clients/useGetClients", () => ({
  useGetClients: () => ({ clients: clientsState.clients }),
}));

vi.mock("../vehicles/useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({
    vehicles: vehiclesState.vehicles,
    isLoading: false,
    isFetched: true,
    isError: false,
  }),
}));

vi.mock("../vehicles/useSearchVehiclesByRegistration", () => ({
  useSearchVehiclesByRegistration: () => ({
    hits: [],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../clients/useGetClientExtensions", () => ({
  useGetClientDiscounts: () => ({ rows: discountsState.rows, available: true, isLoading: false, isError: false }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow(industryState.slug);
      return { workflow, copy: workflow, profile: null, industrySlug: industryState.slug };
    },
  };
});

vi.mock("./useOrderFieldConfig", () => ({
  useOrderFieldConfig: () => ({ fields: [] }),
  fieldConfigMap: () => new Map(),
}));

vi.mock("../clients/ClientCombobox", () => ({
  default: ({
    value,
    onChange,
    onSelect,
    clients,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSelect: (client: Client) => void;
    clients: Client[];
  }) => (
    <div data-testid="client-combobox-stub">
      <input
        data-testid="client-combobox-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {clients.map((client) => (
        <button
          key={client.id}
          type="button"
          data-testid={`pick-client-${client.id}`}
          onClick={() => onSelect(client)}
        >
          {client.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./OrderVehicleFields", () => ({
  OrderVehicleFields: ({
    clientId,
    setValue,
  }: {
    clientId: string;
    setValue: (name: string, value: string) => void;
  }) => (
    <div data-testid="order-vehicle-fields-stub" data-client-id={clientId}>
      <button type="button" data-testid="reset-vehicle" onClick={() => setValue("vehicleId", "")}>
        No vehicle
      </button>
      <button type="button" data-testid="pick-vehicle-v2" onClick={() => setValue("vehicleId", "v-2")}>
        Pick v2
      </button>
    </div>
  ),
}));

vi.mock("../clients/AddClientDialog", () => ({
  AddClientDialog: () => null,
}));

vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));

import ChangeOrderClientDialog from "./ChangeOrderClientDialog";

function order(partial: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    clientId: "c-1",
    clientName: "Ada",
    clientPhone: "111",
    orderNumber: "ORD-1",
    vehicleId: "v-1",
    device: "Toyota",
    vin: "",
    carNumber: "ABC",
    service: "",
    services: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 10,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  } as Order;
}

describe("ChangeOrderClientDialog", () => {
  beforeEach(() => {
    changeMutate.mockReset();
    industryState.slug = "auto_repair";
    clientsState.clients = [
      { id: "c-1", name: "Ada", phone: "111", client_type: "individual" } as Client,
      { id: "c-2", name: "Bob", phone: "222", client_type: "individual" } as Client,
    ];
    vehiclesState.vehicles = [
      { id: "v-1", make: "Toyota", model: "Camry", licensePlate: "ABC", vin: "", year: 2018 },
      { id: "v-2", make: "Honda", model: "Civic", licensePlate: "XYZ", vin: "", year: 2020 },
    ];
    discountsState.rows = [];
  });

  it("disables save when nothing changed", async () => {
    renderWithQuery(
      <ChangeOrderClientDialog order={order()} open onOpenChange={vi.fn()} hasInvoice={false} />,
    );

    await waitFor(() => expect(screen.getByTestId("change-order-client-save")).toBeDisabled());
  });

  it("resets vehicle when the client changes", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <ChangeOrderClientDialog order={order()} open onOpenChange={vi.fn()} hasInvoice={false} />,
    );

    expect(screen.getByTestId("order-vehicle-fields-stub")).toHaveAttribute("data-client-id", "c-1");
    await user.click(screen.getByTestId("pick-client-c-2"));
    await waitFor(() =>
      expect(screen.getByTestId("order-vehicle-fields-stub")).toHaveAttribute("data-client-id", "c-2"),
    );
    expect(screen.getByTestId("change-order-client-save")).not.toBeDisabled();
  });

  it("shows invoice warning and requires confirm before save is enabled", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <ChangeOrderClientDialog order={order()} open onOpenChange={vi.fn()} hasInvoice />,
    );

    await user.click(screen.getByTestId("pick-client-c-2"));
    expect(screen.getByTestId("change-order-client-invoice-warning")).toBeInTheDocument();
    expect(screen.getByTestId("change-order-client-save")).toBeDisabled();
    await user.click(screen.getByTestId("change-order-client-invoice-confirm"));
    await waitFor(() => expect(screen.getByTestId("change-order-client-save")).not.toBeDisabled());
  });

  it("hides the vehicle section for non-vehicle industries", () => {
    industryState.slug = "furniture_manufacturing";
    renderWithQuery(
      <ChangeOrderClientDialog order={order({ vehicleId: null })} open onOpenChange={vi.fn()} hasInvoice={false} />,
    );

    expect(screen.queryByTestId("change-order-client-step-vehicle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-vehicle-fields-stub")).not.toBeInTheDocument();
  });
});
