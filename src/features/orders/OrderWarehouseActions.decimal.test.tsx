import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import OrderWarehouseActions from "./OrderWarehouseActions";

const toastError = vi.fn();

vi.mock("react-hot-toast", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    loading: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => () => undefined,
}));

vi.mock("../inventory/useGetInventoryItems", () => ({
  useGetInventoryItems: () => ({
    items: [{ id: "item-1", name: "Pad", quantity: 10, unit: "шт" }],
  }),
}));

vi.mock("../warehouses/useGetWarehouses", () => ({
  useGetWarehouses: () => ({
    data: [{ id: "wh-1", name: "Main", isActive: true, isDefault: true, deletedAt: null }],
  }),
}));

vi.mock("../warehouses/useGetWarehouseStock", () => ({
  useGetWarehouseStock: () => ({
    data: [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 10 }],
    isSuccess: true,
  }),
}));

const issueFromWarehouse = vi.fn().mockResolvedValue([]);

vi.mock("../../services/apiWarehouse", () => ({
  issueOrderMaterialsFromWarehouse: (...args: unknown[]) => issueFromWarehouse(...args),
  returnOrderMaterialsToWarehouse: vi.fn(),
}));

vi.mock("../../services/apiOrders", () => ({
  getOrder: vi.fn(async () => orderFixture),
}));

const orderFixture: Order = {
  id: "order-1",
  workspace_id: "ws-1",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "1",
  vehicleId: null,
  device: "Car",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  materials: [
    {
      inventoryItemId: "item-1",
      itemName: "Pad",
      price: 10,
      quantity: 2,
      quantityIssued: 0,
      quantityReturned: 0,
      supplySource: "catalog",
      warehouseId: "wh-1",
    },
  ],
  description: "",
  status: "in-progress",
  closedAt: null,
  warrantySourceOrderId: null,
  vehicleMileageSnapshot: null,
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 20,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
};

describe("OrderWarehouseActions decimal quantity", () => {
  beforeEach(() => {
    issueFromWarehouse.mockClear();
    toastError.mockClear();
  });

  it("accepts 0.5 in the issue dialog", async () => {
    const user = userEvent.setup();
    renderWithQuery(<OrderWarehouseActions order={orderFixture} canManage onOrderUpdated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "orders.warehouse.issueAction" }));
    const input = await screen.findByLabelText("orders.warehouse.issueQty");
    await user.clear(input);
    await user.type(input, "0.5");
    await user.click(screen.getByRole("button", { name: "orders.warehouse.confirmIssue" }));

    await waitFor(() => expect(issueFromWarehouse).toHaveBeenCalled());
    const lines = issueFromWarehouse.mock.calls.at(-1)?.[1] as Array<{ quantity: number }>;
    expect(lines?.[0]?.quantity).toBe(0.5);
  });
});
