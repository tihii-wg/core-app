import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import EditOrderForm from "./EditOrderForm";
import type { WarrantySnapshot } from "./warranty";

const confirmMock = vi.hoisted(() => vi.fn(async () => true));
const getWarrantyRecordsForOrder = vi.hoisted(() => vi.fn());

vi.mock("../../ui/ConfirmProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/ConfirmProvider")>();
  return {
    ...actual,
    useConfirm: () => confirmMock,
  };
});

vi.mock("../../services/apiWarranty", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiWarranty")>("../../services/apiWarranty");
  return {
    ...actual,
    getWarrantyRecordsForOrder: (...args: unknown[]) => getWarrantyRecordsForOrder(...args),
  };
});

vi.mock("./useUpdateOrder", () => ({
  useUpdateOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../services/useGetServices", () => ({
  default: () => ({ services: [] }),
}));
vi.mock("../inventory/useGetInventoryItems", () => ({
  useGetInventoryItems: () => ({ items: [] }),
}));
vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees: [], error: null, isLoading: false }),
}));
vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { currency: "MDL" } }),
}));
vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (v: number) => String(v), currency: "MDL" }),
}));
vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));
vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => vi.fn(),
}));
vi.mock("./useClosedOrderPermissions", () => ({
  useClosedOrderActionPermissions: () => ({
    isOwnerByOwnerId: true,
    ownerCanManageClosedOrders: true,
    canManageClosedContent: false,
  }),
}));
vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));
vi.mock("../vehicles/useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({ vehicles: [] }),
}));
vi.mock("../clients/useGetClient", () => ({
  useGetClient: () => ({ client: null }),
}));
vi.mock("../clients/useGetClientExtensions", () => ({
  useGetClientDiscounts: () => ({ rows: [], isLoading: false }),
}));
vi.mock("../finance/useWorkspaceVatRate", () => ({
  useWorkspaceVatRate: () => ({ rate: null }),
}));
vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), profile: null, industrySlug: "auto_repair" };
    },
  };
});
vi.mock("./OrderMaterialLinesEditor", () => ({
  default: () => null,
}));

const record: WarrantySnapshot = {
  id: "wr-1",
  orderId: "order-1",
  itemKind: "service",
  itemName: "Oil change",
  orderServiceId: "svc-line-1",
  orderMaterialId: null,
  startsAt: "2026-05-01T12:00:00.000Z",
  endsOn: "2027-05-01",
  startMileage: 80000,
  expiresAtMileage: null,
  durationMonths: 12,
  mileageLimit: null,
};

const order: Order = {
  id: "order-1",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "ORD-1",
  status: "cancelled",
  closedAt: "2026-05-01T00:00:00.000Z",
  vehicleId: null,
  device: "Car",
  vin: "",
  carNumber: "",
  service: "",
  services: [
    {
      id: "svc-line-1",
      serviceId: "svc-1",
      serviceName: "Oil change",
      price: 100,
      quantity: 1,
      warrantyMonths: 12,
      warrantyKm: null,
      warrantyDays: null,
    },
  ],
  materials: [],
  description: "",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 100,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "",
  updatedAt: "",
};

describe("EditOrderForm warranty line delete confirm", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    getWarrantyRecordsForOrder.mockReset();
    getWarrantyRecordsForOrder.mockResolvedValue([record]);
  });

  it("asks for confirmation before removing a warranty-covered line", async () => {
    const user = userEvent.setup();
    renderWithQuery(<EditOrderForm order={order} onCancel={vi.fn()} onUpdated={vi.fn()} />);

    expect(await screen.findByRole("status")).toHaveAttribute("data-warranty-pause-notice");
    await user.click(screen.getByRole("button", { name: /Remove Oil change/i }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(/Oil change.*01\.05\.2026/i),
        }),
      );
    });
  });

  it("does not confirm when the user cancels the dialog", async () => {
    confirmMock.mockResolvedValue(false);
    const user = userEvent.setup();
    renderWithQuery(<EditOrderForm order={order} onCancel={vi.fn()} onUpdated={vi.fn()} />);
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: /Remove Oil change/i }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(screen.getByText("Oil change")).toBeInTheDocument();
  });
});
