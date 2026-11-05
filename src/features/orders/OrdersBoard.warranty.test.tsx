import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { OrdersBoard } from "./OrdersBoard";
import type { OrderWarrantyIndicatorModel } from "./warranty";

const indicatorModel: OrderWarrantyIndicatorModel = {
  visible: true,
  isWarrantyOrder: false,
  coveredItemCount: 1,
  status: "active",
  evaluation: {
    status: "active",
    expiresOn: "2027-05-04",
    expiresAtMileage: 90000,
    remainingMileage: 7500,
    reason: null,
  },
  remaining: { months: 6, days: 0, totalDays: 181 },
  nearExpiry: false,
  primary: null,
};

const getOrdersWarrantyIndicatorMap = vi.hoisted(() =>
  vi.fn(async () => ({
    "order-1": indicatorModel,
  })),
);

vi.mock("../../services/apiWarranty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/apiWarranty")>();
  return {
    ...actual,
    getOrdersWarrantyIndicatorMap,
  };
});

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true, isReadOnly: false }),
}));

vi.mock("./useGetOrders", () => ({
  useGetOrders: () => ({
    orders: [
      {
        id: "order-1",
        clientId: "client-1",
        clientName: "Ada Lovelace",
        orderNumber: "ORD-2026-100",
        vehicleId: "veh-1",
        device: "BMW",
        vin: "",
        carNumber: "ABC123",
        service: "Oil change",
        services: [],
        description: "",
        status: "in-progress",
        closedAt: "2026-05-04T12:00:00.000Z",
        warrantySourceOrderId: null,
        vehicleMileageSnapshot: 80000,
        assignedEmployeeId: "",
        assignedEmployeeName: "",
        deadline: "2026-12-01",
        totalPrice: 400,
        isPaid: false,
        paymentStatus: "unpaid",
        createdAt: "2026-05-01",
        updatedAt: "2026-05-04",
      } satisfies Order,
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../statuses/useGetStatusDefinitions", () => ({
  useGetStatusDefinitions: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock("./useMoveOrderOnBoard", () => ({
  useMoveOrderOnBoard: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: "auto_repair", industryId: null, isLoading: false, error: null };
    },
  };
});

describe("OrdersBoard warranty indicator", () => {
  beforeEach(() => {
    getOrdersWarrantyIndicatorMap.mockClear();
  });

  it("renders the warranty indicator under the order number on Kanban cards", async () => {
    renderWithQuery(
      <OrdersBoard
        search=""
        employeeFilter="all"
        deadlineFilter="all"
        today="2026-11-04"
        formatMoney={(n) => `MDL ${n}`}
        onOpenOrder={vi.fn()}
        requireTaxInvoiceNumber={false}
        isWorkspaceOwner={false}
      />,
    );

    expect(await screen.findByText("ORD-2026-100")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Warranty · 6 months remaining/i)).toBeInTheDocument();
    });
    expect(document.querySelector("[data-warranty-indicator]")).not.toBeNull();
    expect(getOrdersWarrantyIndicatorMap).toHaveBeenCalled();
  });
});
