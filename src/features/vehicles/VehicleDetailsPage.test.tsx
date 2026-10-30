import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Order, Vehicle } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { VehicleDetailsPage } from "./VehicleDetailsPage";

const vehicleState = vi.hoisted(() => ({
  vehicle: null as Vehicle | null,
  isLoading: false,
  isError: false,
  notFound: false,
}));

const clientState = vi.hoisted(() => ({
  client: null as Client | null,
  isLoading: false,
  notFound: false,
}));

const ordersState = vi.hoisted(() => ({
  orders: [] as Order[],
  isLoading: false,
  isError: false,
}));

const updateVehicle = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: () => ({ locale: "en", workspaceId: "ws-1", vehicleId: "veh-1" }),
  };
});

vi.mock("./useGetVehicle", () => ({
  useGetVehicle: () => ({
    vehicle: vehicleState.vehicle,
    isLoading: vehicleState.isLoading,
    isFetching: false,
    isError: vehicleState.isError,
    notFound: vehicleState.notFound,
    refetch: vi.fn(),
  }),
  vehicleQueryKey: (workspaceId: string | undefined, vehicleId: string) => ["vehicles", workspaceId, "id", vehicleId],
}));

vi.mock("../clients/useGetClient", () => ({
  useGetClient: () => ({
    client: clientState.client,
    isLoading: clientState.isLoading,
    isError: false,
    notFound: clientState.notFound,
    refetch: vi.fn(),
  }),
  clientQueryKey: (workspaceId: string | undefined, clientId: string) => ["clients", workspaceId, "id", clientId],
}));

vi.mock("./useGetVehicleOrders", () => ({
  useGetVehicleOrders: () => ({
    orders: ordersState.orders,
    isLoading: ordersState.isLoading,
    isError: ordersState.isError,
    error: ordersState.isError ? new Error("failed") : null,
    refetch: vi.fn(),
  }),
  vehicleOrdersQueryKey: (workspaceId: string | undefined, vehicleId: string) => ["orders", workspaceId, "vehicle", vehicleId],
}));

vi.mock("./useVehicleMutations", () => ({
  useUpdateVehicle: () => ({ mutateAsync: updateVehicle, isPending: false }),
  useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => () => {},
  useWorkspaceSubscription: () => ({ canWrite: true }),
}));

vi.mock("../workspaces/SubscriptionReadOnlyNotice", () => ({
  SubscriptionReadOnlyNotice: () => null,
}));

vi.mock("../orders/useGetOrders", () => ({
  useGetOrders: () => ({ orders: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
  useGetProfile: () => ({ data: { active_workspace_id: "ws-1" }, isLoading: false, error: null }),
}));

vi.mock("../orders/OrderDetailPanel", () => ({
  default: () => null,
}));

vi.mock("../orders/useOrderDetails", () => ({
  useOrderDetails: () => ({
    openOrder: vi.fn(),
    panelProps: {
      selectedOrder: null,
      detailPanelOpen: false,
      setDetailPanelOpen: vi.fn(),
      onOrderUpdated: vi.fn(),
      onStatusChange: vi.fn(),
      isStatusUpdating: false,
    },
  }),
}));

const vehicle: Vehicle = {
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

const client: Client = {
  id: "client-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+37361111111",
  address: "",
  balance: 0,
  created_at: "2024-07-01T10:00:00.000Z",
  notes: "",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  orderNumber: "ORD-2026-003",
  vehicleId: "veh-1",
  device: "Toyota Corolla 2018",
  vin: "1HGBH41JXMN109186",
  carNumber: "ABC123",
  service: "Oil change",
  services: [],
  description: "Noise",
  status: "new",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 40,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26",
};

describe("VehicleDetailsPage", () => {
  beforeEach(() => {
    vehicleState.vehicle = vehicle;
    vehicleState.isLoading = false;
    vehicleState.isError = false;
    vehicleState.notFound = false;
    clientState.client = client;
    clientState.isLoading = false;
    clientState.notFound = false;
    ordersState.orders = [];
    ordersState.isLoading = false;
    ordersState.isError = false;
    updateVehicle.mockReset();
    updateVehicle.mockResolvedValue({ ...vehicle, currentMileage: 46000 });
  });

  it("renders vehicle fields, owner link, and an empty order history", () => {
    renderWithQuery(<VehicleDetailsPage />);

    expect(screen.getByRole("heading", { name: /Toyota Corolla 2018/i })).toBeInTheDocument();
    expect(screen.getByText("1HGBH41JXMN109186")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to orders" })).toHaveAttribute("href", "/en/ws-1/orders");
  });

  it("falls back to the orders list from the missing-vehicle state", () => {
    vehicleState.vehicle = null;
    vehicleState.notFound = true;
    renderWithQuery(<VehicleDetailsPage />);

    expect(screen.getByRole("link", { name: "Back to orders" })).toHaveAttribute("href", "/en/ws-1/orders");
    expect(screen.getByText("Vehicle was not found or you do not have permission")).toBeInTheDocument();
  });

  it("lists linked orders newest-first content", () => {
    ordersState.orders = [order];
    renderWithQuery(<VehicleDetailsPage />);

    expect(screen.getByText("ORD-2026-003")).toBeInTheDocument();
    expect(screen.getByText("Oil change · Noise")).toBeInTheDocument();
    expect(screen.getByText("MDL 40.00")).toBeInTheDocument();
  });

  it("saves current mileage through the existing vehicle update", async () => {
    const user = userEvent.setup();
    renderWithQuery(<VehicleDetailsPage />);

    const input = screen.getByLabelText("Current mileage");
    await user.clear(input);
    await user.type(input, "46000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateVehicle).toHaveBeenCalledWith({
      vehicleId: "veh-1",
      input: expect.objectContaining({ currentMileage: 46000, make: "Toyota", vin: "1HGBH41JXMN109186" }),
    });
  });
});
