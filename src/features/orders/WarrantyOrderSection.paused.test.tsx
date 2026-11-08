import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import WarrantyOrderSection from "./WarrantyOrderSection";
import type { WarrantySnapshot } from "./warranty";

const getWarrantyRecordsForOrder = vi.hoisted(() => vi.fn());
const getWarrantyClaimsForOrder = vi.hoisted(() => vi.fn(async () => []));

vi.mock("../../services/apiWarranty", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiWarranty")>("../../services/apiWarranty");
  return {
    ...actual,
    getWarrantyRecordsForOrder: (...args: unknown[]) => (getWarrantyRecordsForOrder as (...a: unknown[]) => unknown)(...args),
    getWarrantyClaimsForOrder: (...args: unknown[]) => (getWarrantyClaimsForOrder as (...a: unknown[]) => unknown)(...args),
    saveWarrantyOrderLink: vi.fn(),
    clearWarrantyOrderLink: vi.fn(),
  };
});

vi.mock("./useGetOrders", () => ({
  useGetOrders: () => ({
    orders: [
      {
        id: "src-1",
        clientId: "c1",
        clientName: "Ada",
        orderNumber: "ORD-SRC",
        status: "cancelled",
        closedAt: "2026-05-01T00:00:00.000Z",
        vehicleId: "v1",
        device: "",
        vin: "",
        carNumber: "",
        service: "",
        services: [],
        description: "",
        assignedEmployeeId: "",
        assignedEmployeeName: "",
        deadline: "",
        totalPrice: 0,
        isPaid: false,
        paymentStatus: "unpaid",
        createdAt: "",
        updatedAt: "",
        vehicleMileageSnapshot: 80000,
        vehicleMileageUnitSnapshot: "km",
      } satisfies Order,
    ],
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

const snapshot: WarrantySnapshot = {
  id: "wr-1",
  orderId: "src-1",
  itemKind: "service",
  itemName: "Oil change",
  orderServiceId: "svc-1",
  orderMaterialId: null,
  startsAt: "2026-05-01T12:00:00.000Z",
  endsOn: "2027-05-01",
  startMileage: 80000,
  expiresAtMileage: null,
  durationMonths: 12,
  mileageLimit: null,
};

const claimOrder: Order = {
  id: "claim-1",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "ORD-CLAIM",
  status: "in-progress",
  closedAt: null,
  vehicleId: "v1",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  description: "",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 0,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "",
  updatedAt: "",
  warrantySourceOrderId: "src-1",
};

describe("WarrantyOrderSection paused records", () => {
  beforeEach(() => {
    getWarrantyRecordsForOrder.mockReset();
    getWarrantyRecordsForOrder.mockResolvedValue([snapshot]);
    getWarrantyClaimsForOrder.mockResolvedValue([]);
  });

  it("lists paused records as disabled with the pause explanation", async () => {
    renderWithQuery(<WarrantyOrderSection order={claimOrder} currentMileage={82000} />);
    expect(await screen.findByText("Oil change")).toBeInTheDocument();
    const option = screen.getByText("Oil change").closest("[data-warranty-claim-option]");
    expect(option).toHaveAttribute("data-warranty-status", "paused");
    const checkbox = option?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeDisabled();
    expect(
      screen.getByText(/Warranty is paused: the original order was cancelled or reopened/i),
    ).toBeInTheDocument();
  });
});
