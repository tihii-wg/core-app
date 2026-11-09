import { describe, expect, it } from "vitest";
import { filterClientCardSearch, highlightMatch, normalizePlateVin } from "./clientSearch";
import type { ClientSearchableOrder } from "./clientSearch";
import { industryProfile } from "../industries/industryProfile";

function order(partial: Partial<ClientSearchableOrder> & Pick<ClientSearchableOrder, "id" | "orderNumber">): ClientSearchableOrder {
  return {
    status: "new",
    customStatus: null,
    device: "",
    carNumber: "",
    vin: "",
    deviceSerial: "",
    deviceImei: "",
    siteAddress: "",
    productDimensions: "",
    description: "",
    assignedEmployeeName: "",
    totalPrice: 0,
    createdAt: "2026-01-15",
    deadline: "",
    isPaid: false,
    services: [],
    materials: [],
    vehicleId: null,
    ...partial,
  };
}

describe("normalizePlateVin", () => {
  it("strips spaces/dashes and maps Cyrillic look-alikes", () => {
    expect(normalizePlateVin("AB 123")).toBe("AB123");
    expect(normalizePlateVin("AB-123")).toBe("AB123");
    expect(normalizePlateVin("АВ 123")).toBe("AB123");
    expect(normalizePlateVin("с 001 кх")).toBe("C001KX");
  });
});

describe("filterClientCardSearch", () => {
  const furnitureBlocks = industryProfile("furniture_manufacturing").orderFieldBlocks;
  const phoneBlocks = industryProfile("phone_electronics_repair").orderFieldBlocks;

  it("matches order number, status label, and payment label", () => {
    const result = filterClientCardSearch({
      query: "оплачен",
      orders: [
        order({ id: "1", orderNumber: "ORD-1", isPaid: false, totalPrice: 100 }),
        order({ id: "2", orderNumber: "ORD-2", isPaid: false, totalPrice: 100 }),
      ],
      vehicles: [],
      payments: [
        {
          id: "p1",
          workspaceId: "ws",
          kind: "payment",
          amount: 100,
          currencyCode: "MDL",
          paymentMethod: "cash",
          paidAt: "2026-01-01",
          orderId: "2",
          invoiceId: null,
          relatedPaymentId: null,
          note: "",
          createdBy: null,
          createdAt: "2026-01-01",
        },
      ],
      paymentLabels: { unpaid: "не оплачен", partial: "частично", paid: "оплачен" },
    });
    expect(result.orderIds).toEqual(["2"]);
  });

  it("matches plates ignoring spaces and Cyrillic/Latin look-alikes", () => {
    const result = filterClientCardSearch({
      query: "AB 123",
      orders: [order({ id: "1", orderNumber: "ORD-1", carNumber: "АВ-123" })],
      vehicles: [{ id: "v1", make: "BMW", model: "X5", year: 2020, licensePlate: "AB-123", vin: null }],
    });
    expect(result.orderIds).toEqual(["1"]);
    expect(result.vehicleIds).toEqual(["v1"]);
  });

  it("matches furniture site address and dimensions when industry blocks allow", () => {
    const withBlocks = filterClientCardSearch({
      query: "chisinau",
      orders: [order({ id: "1", orderNumber: "ORD-1", siteAddress: "Chisinau, str. 1", productDimensions: "200x80" })],
      vehicles: [],
      industryBlocks: furnitureBlocks,
    });
    expect(withBlocks.orderIds).toEqual(["1"]);

    const without = filterClientCardSearch({
      query: "chisinau",
      orders: [order({ id: "1", orderNumber: "ORD-1", siteAddress: "Chisinau, str. 1" })],
      vehicles: [],
      industryBlocks: industryProfile("auto_repair").orderFieldBlocks,
    });
    expect(without.orderIds).toEqual([]);
  });

  it("matches device serial/IMEI for phone industries and service line names", () => {
    const result = filterClientCardSearch({
      query: "imei99",
      orders: [
        order({
          id: "1",
          orderNumber: "ORD-1",
          deviceImei: "IMEI99",
          services: [{ serviceId: "s1", serviceName: "Screen", price: 10, quantity: 1 }],
        }),
      ],
      vehicles: [],
      industryBlocks: phoneBlocks,
    });
    expect(result.orderIds).toEqual(["1"]);

    const byService = filterClientCardSearch({
      query: "oil",
      orders: [
        order({
          id: "2",
          orderNumber: "ORD-2",
          services: [{ serviceId: "s2", serviceName: "Oil change", price: 40, quantity: 1 }],
        }),
      ],
      vehicles: [],
    });
    expect(byService.orderIds).toEqual(["2"]);
  });

  it("matches partial dd.mm.yyyy dates", () => {
    const result = filterClientCardSearch({
      query: "15.01",
      orders: [order({ id: "1", orderNumber: "ORD-1", createdAt: "2026-01-15T10:00:00.000Z" })],
      vehicles: [],
    });
    expect(result.orderIds).toEqual(["1"]);
  });

  it("returns all ids when query is empty", () => {
    const result = filterClientCardSearch({
      query: "  ",
      orders: [order({ id: "1", orderNumber: "A" }), order({ id: "2", orderNumber: "B" })],
      vehicles: [{ id: "v1", make: "A", model: "B", year: 1, licensePlate: null, vin: null }],
    });
    expect(result.orderIds).toEqual(["1", "2"]);
    expect(result.vehicleIds).toEqual(["v1"]);
    expect(result.normalizedQuery).toBe("");
  });
});

describe("highlightMatch", () => {
  it("wraps case-insensitive matches and escapes HTML", () => {
    expect(highlightMatch("Oil <change>", "oil")).toBe("<mark>Oil</mark> &lt;change&gt;");
  });
});
