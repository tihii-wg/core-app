import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterEligibleWarrantySourceOrders, getOrdersWarrantyIndicatorMap } from "./apiWarranty";
import type { Order } from "../lib/types";

const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: { from },
}));

function order(partial: Partial<Order> & Pick<Order, "id" | "clientId">): Order {
  return {
    orderNumber: partial.orderNumber ?? "ORD-1",
    vehicleId: partial.vehicleId ?? null,
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: partial.status ?? "closed",
    closedAt: partial.closedAt ?? "2026-11-04T12:00:00.000Z",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
    clientName: "Ada",
    ...partial,
  };
}

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

/** Thenable PostgREST-style chain used by getOrdersWarrantyIndicatorMap. */
function thenable(result: QueryResult, onSelect?: (columns: string) => void) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = (columns: string) => {
    onSelect?.(columns);
    return chain;
  };
  chain.eq = self;
  chain.in = self;
  chain.order = self;
  chain.then = (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const sampleRecord = {
  id: "wr-1",
  order_id: "order-1",
  item_kind: "service",
  item_name: "Oil change",
  order_service_id: "svc-1",
  order_material_id: null,
  duration_months: 12,
  duration_days: null,
  mileage_limit: 10000,
  starts_at: "2026-05-04T12:00:00.000Z",
  starts_on: "2026-05-04",
  ends_on: "2027-05-04",
  start_mileage: 80000,
  expires_at_mileage: 90000,
};

describe("filterEligibleWarrantySourceOrders", () => {
  const base = [
    order({ id: "o1", clientId: "c1", vehicleId: "v1", orderNumber: "ORD-1" }),
    order({ id: "o2", clientId: "c1", vehicleId: "v2", orderNumber: "ORD-2" }),
    order({ id: "o3", clientId: "c2", vehicleId: "v1", orderNumber: "ORD-3" }),
    order({ id: "o4", clientId: "c1", vehicleId: "v1", status: "in-progress", closedAt: null, orderNumber: "ORD-4" }),
    order({ id: "o5", clientId: "c1", vehicleId: "v1", status: "cancelled", closedAt: null, orderNumber: "ORD-5" }),
  ];

  it("keeps only same client + vehicle closed originals and excludes self", () => {
    expect(
      filterEligibleWarrantySourceOrders({
        candidates: base,
        clientId: "c1",
        vehicleId: "v1",
        excludeOrderId: "claim-1",
      }).map((row) => row.id),
    ).toEqual(["o1"]);
  });

  it("rejects cross-client and cross-vehicle references", () => {
    expect(
      filterEligibleWarrantySourceOrders({
        candidates: base,
        clientId: "c1",
        vehicleId: "v2",
        excludeOrderId: "x",
      }).map((row) => row.id),
    ).toEqual(["o2"]);
  });
});

describe("getOrdersWarrantyIndicatorMap", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("builds active indicators for original orders from warranty_records", async () => {
    const selects: string[] = [];
    from.mockImplementation((table: string) => {
      if (table === "warranty_records") {
        return thenable({ data: [sampleRecord], error: null }, (columns) => selects.push(columns));
      }
      if (table === "vehicles") {
        return thenable({ data: [{ id: "veh-1", current_mileage: 82500 }], error: null });
      }
      return thenable({ data: [], error: null });
    });

    const map = await getOrdersWarrantyIndicatorMap(
      "ws-1",
      [
        {
          id: "order-1",
          status: "closed",
          warrantySourceOrderId: null,
          vehicleId: "veh-1",
          vehicleMileageSnapshot: 80000,
          closedAt: "2026-05-04T12:00:00.000Z",
        },
      ],
      "2026-11-04T12:00:00.000Z",
    );

    expect(selects[0]).toMatch(/duration_days/);
    expect(map["order-1"]?.visible).toBe(true);
    expect(map["order-1"]?.status).toBe("active");
    expect(map["order-1"]?.remaining?.months).toBeGreaterThan(0);
    expect(map["order-1"]?.evaluation?.remainingMileage).toBe(7500);
  });

  it("falls back to legacy columns when duration_days is missing (PGRST204)", async () => {
    const selects: string[] = [];
    let warrantyCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "warranty_records") {
        warrantyCalls += 1;
        if (warrantyCalls === 1) {
          return thenable(
            {
              data: null,
              error: {
                code: "PGRST204",
                message: "Could not find the 'duration_days' column of 'warranty_records' in the schema cache",
              },
            },
            (columns) => selects.push(columns),
          );
        }
        const { duration_days: _omit, ...legacyRow } = sampleRecord;
        return thenable({ data: [legacyRow], error: null }, (columns) => selects.push(columns));
      }
      if (table === "vehicles") return thenable({ data: [], error: null });
      return thenable({ data: [], error: null });
    });

    const map = await getOrdersWarrantyIndicatorMap(
      "ws-1",
      [
        {
          id: "order-1",
          status: "closed",
          warrantySourceOrderId: null,
          vehicleId: null,
          vehicleMileageSnapshot: null,
          closedAt: "2026-05-04T12:00:00.000Z",
        },
      ],
      "2026-11-04T12:00:00.000Z",
    );

    expect(selects).toHaveLength(2);
    expect(selects[0]).toMatch(/duration_days/);
    expect(selects[1]).not.toMatch(/duration_days/);
    expect(map["order-1"]?.visible).toBe(true);
    expect(map["order-1"]?.status).toBe("active");
  });

  it("throws on real database errors instead of returning an empty warranty map", async () => {
    from.mockImplementation((table: string) => {
      if (table === "warranty_records") {
        return thenable({
          data: null,
          error: { code: "42501", message: "permission denied for table warranty_records" },
        });
      }
      return thenable({ data: [], error: null });
    });

    await expect(
      getOrdersWarrantyIndicatorMap("ws-1", [
        {
          id: "order-1",
          status: "in-progress",
          warrantySourceOrderId: null,
          vehicleId: null,
          vehicleMileageSnapshot: null,
          closedAt: null,
        },
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("returns invisible models when an order has no warranty records", async () => {
    from.mockImplementation((table: string) => {
      if (table === "warranty_records") return thenable({ data: [], error: null });
      if (table === "vehicles") return thenable({ data: [], error: null });
      return thenable({ data: [], error: null });
    });

    const map = await getOrdersWarrantyIndicatorMap("ws-1", [
      {
        id: "order-plain",
        status: "in-progress",
        warrantySourceOrderId: null,
        vehicleId: null,
        vehicleMileageSnapshot: null,
        closedAt: null,
      },
    ]);

    expect(map["order-plain"]?.visible).toBe(false);
    expect(map["order-plain"]?.status).toBe("none");
  });

  it("marks expired warranties from ends_on", async () => {
    from.mockImplementation((table: string) => {
      if (table === "warranty_records") {
        return thenable({
          data: [{ ...sampleRecord, ends_on: "2026-01-01", expires_at_mileage: null, mileage_limit: null }],
          error: null,
        });
      }
      if (table === "vehicles") return thenable({ data: [], error: null });
      return thenable({ data: [], error: null });
    });

    const map = await getOrdersWarrantyIndicatorMap(
      "ws-1",
      [
        {
          id: "order-1",
          status: "closed",
          warrantySourceOrderId: null,
          vehicleId: null,
          vehicleMileageSnapshot: null,
          closedAt: "2026-05-04T12:00:00.000Z",
        },
      ],
      "2026-11-04T12:00:00.000Z",
    );

    expect(map["order-1"]?.visible).toBe(true);
    expect(map["order-1"]?.status).toBe("expired_date");
  });

  it("marks warranties paused when the source order is cancelled or reopened", async () => {
    from.mockImplementation((table: string) => {
      if (table === "warranty_records") return thenable({ data: [sampleRecord], error: null });
      if (table === "vehicles") return thenable({ data: [], error: null });
      return thenable({ data: [], error: null });
    });

    const cancelled = await getOrdersWarrantyIndicatorMap(
      "ws-1",
      [
        {
          id: "order-1",
          status: "cancelled",
          warrantySourceOrderId: null,
          vehicleId: null,
          vehicleMileageSnapshot: null,
          closedAt: "2026-05-04T12:00:00.000Z",
        },
      ],
      "2026-11-04T12:00:00.000Z",
    );
    expect(cancelled["order-1"]?.status).toBe("paused");
    expect(cancelled["order-1"]?.remaining).toBeNull();

    const reopened = await getOrdersWarrantyIndicatorMap(
      "ws-1",
      [
        {
          id: "order-1",
          status: "in-progress",
          warrantySourceOrderId: null,
          vehicleId: null,
          vehicleMileageSnapshot: null,
          closedAt: null,
        },
      ],
      "2026-11-04T12:00:00.000Z",
    );
    expect(reopened["order-1"]?.status).toBe("paused");
  });
});
