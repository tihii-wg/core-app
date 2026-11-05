import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Order } from "../../lib/types";
import { catalogItemToOrderMaterial } from "../inventory/orderMaterialLine";
import { OrderLineWarrantyBadge } from "./OrderLineWarrantyBadge";
import { OrderWarrantyCoverageSection } from "./OrderWarrantyCoverageSection";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import {
  buildOrderWarrantyIndicator,
  evaluateWarranty,
  type WarrantySnapshot,
} from "./warranty";
import { canMutateOrderContent } from "./closedOrderPermissions";
import {
  catalogWarrantyFromDbRow,
  resolveOrderLineWarrantyForKind,
} from "./catalogWarranty";

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../../services/apiWarranty", () => ({
  getWarrantyRecordsForOrder: vi.fn(async () => [] as WarrantySnapshot[]),
}));

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    workspace_id: "ws-1",
    clientId: "client-1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    vehicleId: null,
    device: "Car",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    materials: [],
    description: "",
    status: "in-progress",
    closedAt: null,
    warrantySourceOrderId: null,
    vehicleMileageSnapshot: null,
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 100,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-11-01",
    updatedAt: "2026-11-01",
    ...overrides,
  };
}

const activatedSnapshot: WarrantySnapshot = {
  id: "wr-1",
  orderId: "order-1",
  itemKind: "material",
  itemName: "Brake pads",
  orderServiceId: null,
  orderMaterialId: "om-1",
  durationMonths: 12,
  durationDays: null,
  mileageLimit: 20000,
  startsAt: "2026-05-01T00:00:00.000Z",
  endsOn: "2027-05-01",
  startMileage: 50000,
  expiresAtMileage: 70000,
};

describe("material warranty lifecycle (card → line → indicators)", () => {
  it("copies duration warranty defaults from the material card onto a new order line", () => {
    const line = catalogItemToOrderMaterial(
      {
        id: "item-1",
        name: "Pads",
        sellingPrice: 10,
        warrantyType: "duration",
        warrantyMonths: 12,
        warrantyKm: null,
      },
      1,
    );
    expect(line).toMatchObject({ warrantyMonths: 12, warrantyKm: null });
  });

  it("copies mileage warranty defaults from the material card onto a new order line", () => {
    const line = catalogItemToOrderMaterial(
      {
        id: "item-1",
        name: "Pads",
        sellingPrice: 10,
        warrantyType: "mileage",
        warrantyMonths: null,
        warrantyKm: 20000,
      },
      1,
    );
    expect(line).toMatchObject({ warrantyMonths: null, warrantyKm: 20000 });
  });

  it("keeps a manual order-line override instead of re-reading live catalog defaults", () => {
    const catalogNow = catalogWarrantyFromDbRow({
      warranty_type: "duration",
      warranty_months: 3,
      warranty_km: null,
    });
    const savedLine = { warrantyMonths: 36, warrantyDays: null, warrantyKm: 50000 };
    const freshFromCard = resolveOrderLineWarrantyForKind(catalogNow, null, "material");
    expect(freshFromCard.warrantyMonths).toBe(3);
    // Reopen must keep savedLine, never replace with freshFromCard.
    expect(savedLine).toMatchObject({ warrantyMonths: 36, warrantyKm: 50000 });
    expect(savedLine.warrantyMonths).not.toBe(freshFromCard.warrantyMonths);
  });

  it("shows configured warranty in the detail coverage card before activation", () => {
    renderWithQuery(
      <OrderWarrantyCoverageSection
        order={baseOrder({
          materials: [
            {
              id: "om-1",
              inventoryItemId: "item-1",
              itemName: "Brake pads",
              price: 12,
              quantity: 1,
              warrantyMonths: 12,
              warrantyKm: 20000,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Brake pads")).toBeInTheDocument();
    expect(screen.getByText(/Warranty: 12 months \/ 20,000 km/)).toBeInTheDocument();
  });

  it("shows warranty under the order number from activated warranty_records", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [activatedSnapshot],
      currentMileage: 55000,
      isWarrantyOrder: false,
      nowIso: "2026-08-01T00:00:00.000Z",
    });
    expect(model.visible).toBe(true);
    renderWithQuery(<OrderWarrantyIndicator model={model} />);
    expect(screen.getByText(/Warranty/)).toBeInTheDocument();
  });

  it("shows warranty information for closed orders in read-only mode", () => {
    const closed = baseOrder({
      status: "closed",
      closedAt: "2026-05-01T00:00:00.000Z",
      materials: [
        {
          id: "om-1",
          itemName: "Brake pads",
          price: 12,
          quantity: 1,
          warrantyMonths: 12,
          warrantyKm: null,
        },
      ],
    });
    expect(
      canMutateOrderContent({
        order: closed,
        isOwnerByOwnerId: false,
        ownerCanManageClosedOrders: true,
      }),
    ).toBe(false);

    renderWithQuery(
      <OrderLineWarrantyBadge
        activated
        limits={{ durationMonths: 12, mileageLimit: null }}
      />,
    );
    expect(screen.getByText("Warranty: 12 months")).toBeInTheDocument();
    expect(screen.getByText("Warranty: 12 months").closest("[data-warranty-line]")).toHaveAttribute(
      "data-warranty-activated",
      "true",
    );
  });

  it("preserves activation remaining duration/mileage calculations", () => {
    const evaluation = evaluateWarranty({
      snapshot: activatedSnapshot,
      currentMileage: 55000,
      nowIso: "2026-08-01T00:00:00.000Z",
    });
    expect(evaluation.status).toBe("active");
    expect(evaluation.remainingMileage).toBe(15000);
    expect(evaluation.expiresOn).toBe("2027-05-01");
  });
});
