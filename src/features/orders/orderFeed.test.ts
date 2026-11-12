import { describe, expect, it } from "vitest";
import type { OrderEvent } from "../../services/apiOrderEvents";
import {
  buildMaterialLineEventPayload,
  buildPaymentTimelinePayload,
  buildServiceLineEventPayload,
  classifyPaymentSettlement,
  describeOrderEvent,
  isPlaceholderOrderNumber,
  orderEventCategory,
  resolveOrderCreatedNumber,
} from "./orderFeed";

const event = (partial: Partial<OrderEvent>): OrderEvent => ({
  id: "e",
  orderId: "o",
  eventType: "status_changed",
  fieldName: "status",
  oldValue: null,
  newValue: null,
  payload: {},
  actorName: null,
  actorUserId: null,
  createdAt: "2026-11-01T10:00:00Z",
  ...partial,
});

const label = (value: string) => value.toUpperCase();

describe("describeOrderEvent", () => {
  it("labels system status changes and shows a dash for missing values", () => {
    expect(describeOrderEvent(event({ oldValue: "new", newValue: "paid" }), label)).toEqual({
      key: "statusChanged",
      params: { from: "NEW", to: "PAID" },
    });
    expect(describeOrderEvent(event({ newValue: "paid" }), label).params.from).toBe("—");
  });

  it("renders legacy custom_status_id events as the same Status changed copy", () => {
    expect(
      describeOrderEvent(event({ fieldName: "custom_status_id", oldValue: "id1", newValue: "id2", payload: { old_name: "QA", new_name: " Ready " } }), label),
    ).toEqual({ key: "statusChanged", params: { from: "QA", to: "Ready" } });
    expect(describeOrderEvent(event({ fieldName: "custom_status_id", oldValue: "id1" }), label).params).toEqual({ from: "—", to: "—" });
  });

  it("maps close and cancel lifecycle status changes without a second event type", () => {
    expect(describeOrderEvent(event({ oldValue: "paid", newValue: "closed", payload: { lifecycle: "close" } }), label).key).toBe("orderClosed");
    expect(describeOrderEvent(event({ oldValue: "in-progress", newValue: "cancelled", payload: { lifecycle: "cancel" } }), label).key).toBe(
      "orderCancelled",
    );
    expect(describeOrderEvent(event({ oldValue: "cancelled", newValue: "in-progress", payload: { lifecycle: "reopen" } }), label).key).toBe(
      "orderReopened",
    );
  });

  it("describes service and labor line snapshots from the frozen payload", () => {
    expect(
      describeOrderEvent(
        event({
          eventType: "service_added",
          payload: buildServiceLineEventPayload({ lineId: "l1", itemName: "Oil change", quantity: 1, price: 40, kind: "service" }),
        }),
        label,
      ),
    ).toMatchObject({ key: "serviceAdded", params: { item: "Oil change", quantity: "1", price: "40" } });

    expect(
      describeOrderEvent(
        event({
          eventType: "service_added",
          payload: buildServiceLineEventPayload({ lineId: "l2", itemName: "Diagnose noise", quantity: 2, price: 25, kind: "labor" }),
        }),
        label,
      ).key,
    ).toBe("workAdded");

    expect(
      describeOrderEvent(
        event({
          eventType: "service_updated",
          payload: buildServiceLineEventPayload({
            lineId: "l1",
            itemName: "Oil change",
            quantity: 2,
            price: 50,
            kind: "service",
            changes: { price: { from: 40, to: 50 }, quantity: { from: 1, to: 2 } },
          }),
        }),
        label,
      ).params,
    ).toMatchObject({ item: "Oil change", quantity: "1 → 2", price: "40 → 50" });
  });

  it("describes material add/remove/update and warehouse issue/return separately", () => {
    expect(
      describeOrderEvent(
        event({
          eventType: "material_added",
          payload: buildMaterialLineEventPayload({ lineId: "m1", itemName: "Brake pads", quantity: 2, price: 12 }),
        }),
        label,
      ).key,
    ).toBe("materialAdded");

    expect(
      describeOrderEvent(
        event({
          eventType: "material_updated",
          payload: buildMaterialLineEventPayload({
            lineId: "m1",
            itemName: "Brake pads",
            quantity: 3,
            price: 12,
            changes: { quantity: { from: 2, to: 3 } },
          }),
        }),
        label,
      ).params.quantity,
    ).toBe("2 → 3");

    expect(
      describeOrderEvent(
        event({
          eventType: "material_issued",
          payload: buildMaterialLineEventPayload({ lineId: "m1", itemName: "Brake pads", quantity: 1, price: 12, quantityIssued: 1 }),
        }),
        label,
      ).key,
    ).toBe("materialIssued");

    expect(
      describeOrderEvent(
        event({
          eventType: "material_returned",
          payload: buildMaterialLineEventPayload({ lineId: "m1", itemName: "Brake pads", quantity: 1, price: 12, quantityReturned: 1 }),
        }),
        label,
      ).key,
    ).toBe("materialReturned");
  });

  it("keeps historical item names from the payload after catalog renames", () => {
    const described = describeOrderEvent(
      event({
        eventType: "material_added",
        payload: buildMaterialLineEventPayload({ lineId: "m1", itemName: "Old brake pad name", quantity: 1, price: 9 }),
      }),
      label,
    );
    expect(described.params.item).toBe("Old brake pad name");
  });

  it("falls back to a generic description for other event types", () => {
    expect(describeOrderEvent(event({ eventType: "field_changed", fieldName: "deadline", oldValue: "a", newValue: "b" }), label)).toEqual({
      key: "generic",
      params: { type: "field_changed", field: "deadline", from: "a", to: "b" },
    });
  });

  it("describes client and vehicle changes", () => {
    expect(describeOrderEvent(event({ eventType: "client_changed", oldValue: "Ada", newValue: "Bob" }), label)).toEqual({
      key: "clientChanged",
      params: { from: "Ada", to: "Bob" },
    });
    expect(describeOrderEvent(event({ eventType: "vehicle_changed", oldValue: "Toyota", newValue: "Honda" }), label)).toEqual({
      key: "vehicleChanged",
      params: { from: "Toyota", to: "Honda" },
    });
  });

  it("classifies payment settlements for partial, full, and balance payments", () => {
    expect(classifyPaymentSettlement({ kind: "payment", remainingAfter: 40, priorNetPaid: 0 })).toBe("partial");
    expect(classifyPaymentSettlement({ kind: "payment", remainingAfter: 0, priorNetPaid: 0 })).toBe("full");
    expect(classifyPaymentSettlement({ kind: "payment", remainingAfter: 0, priorNetPaid: 40 })).toBe("balance");
    expect(classifyPaymentSettlement({ kind: "refund", remainingAfter: 40, priorNetPaid: 60 })).toBe("refund");
  });

  it("describes partial, full, balance, refund, and void payment events distinctly", () => {
    expect(
      describeOrderEvent(
        event({
          eventType: "payment_recorded",
          payload: buildPaymentTimelinePayload({
            paymentId: "p1",
            kind: "payment",
            amount: 40,
            currencyCode: "EUR",
            paymentMethod: "cash",
            settlement: "partial",
            remainingAfter: 60,
            netPaidAfter: 40,
            orderTotal: 100,
          }),
        }),
        label,
      ),
    ).toMatchObject({
      key: "paymentPartial",
      params: { amount: "40", currency: "EUR", method: "Cash", remaining: "60" },
    });

    expect(
      describeOrderEvent(
        event({
          eventType: "payment_recorded",
          payload: buildPaymentTimelinePayload({
            paymentId: "p2",
            kind: "payment",
            amount: 100,
            currencyCode: "EUR",
            paymentMethod: "card",
            settlement: "full",
            remainingAfter: 0,
            netPaidAfter: 100,
            orderTotal: 100,
          }),
        }),
        label,
      ).key,
    ).toBe("paymentFull");

    expect(
      describeOrderEvent(
        event({
          eventType: "payment_recorded",
          payload: buildPaymentTimelinePayload({
            paymentId: "p3",
            kind: "payment",
            amount: 60,
            currencyCode: "EUR",
            paymentMethod: "bank-transfer",
            settlement: "balance",
            remainingAfter: 0,
            netPaidAfter: 100,
            orderTotal: 100,
          }),
        }),
        label,
      ).key,
    ).toBe("paymentBalance");

    expect(
      describeOrderEvent(
        event({
          eventType: "payment_refunded",
          payload: buildPaymentTimelinePayload({
            paymentId: "r1",
            kind: "refund",
            amount: 20,
            currencyCode: "EUR",
            paymentMethod: "cash",
            settlement: "refund",
            remainingAfter: 20,
            netPaidAfter: 80,
            orderTotal: 100,
            relatedPaymentId: "p2",
          }),
        }),
        label,
      ).key,
    ).toBe("paymentRefund");

    expect(orderEventCategory(event({ eventType: "payment_recorded" }))).toBe("payment");
    expect(orderEventCategory(event({ eventType: "payment_refunded" }))).toBe("refund");
    expect(orderEventCategory(event({ eventType: "warranty_activated" }))).toBe("warranty");
    expect(orderEventCategory(event({ eventType: "order_created" }))).toBe("lifecycle");
  });

  it("describes order creation, field edits, and warranty events", () => {
    expect(
      describeOrderEvent(event({ eventType: "order_created", payload: { order_number: "ORD-1" }, newValue: "ORD-1" }), label),
    ).toEqual({ key: "orderCreated", params: { number: "ORD-1" } });

    expect(
      describeOrderEvent(
        event({
          eventType: "order_field_changed",
          payload: { changes: { vin: { from: "A", to: "B" }, device: { from: "X", to: "Y" } } },
        }),
        label,
      ).params.fields,
    ).toContain("VIN");

    expect(
      describeOrderEvent(event({ eventType: "warranty_activated", payload: { item_name: "Battery" } }), label),
    ).toEqual({ key: "warrantyActivated", params: { item: "Battery" } });
  });

  it("resolves creation history to the live order number instead of ORD-PENDING / UUID", () => {
    const pending = `ORD-PENDING-${"a".repeat(8)}-bbbb-cccc-dddd-${"e".repeat(12)}`;
    expect(
      describeOrderEvent(
        event({ eventType: "order_created", payload: { order_number: pending }, newValue: pending }),
        label,
        { orderNumber: "ORD-2026-015" },
      ),
    ).toEqual({ key: "orderCreated", params: { number: "ORD-2026-015" } });

    expect(
      describeOrderEvent(
        event({
          eventType: "order_created",
          payload: { order_number: "11111111-2222-3333-4444-555555555555" },
          newValue: "11111111-2222-3333-4444-555555555555",
        }),
        label,
        { orderNumber: "ORD-2026-015" },
      ).params.number,
    ).toBe("ORD-2026-015");

    // Never invent a number or surface ORD-PENDING / UUID when no live number exists.
    expect(
      describeOrderEvent(
        event({ eventType: "order_created", payload: { order_number: pending }, newValue: pending }),
        label,
        { orderNumber: "" },
      ).params.number,
    ).toBe("—");

    // Stored real number stays compatible when no live override is passed.
    expect(
      describeOrderEvent(event({ eventType: "order_created", payload: { order_number: "ORD-2026-009" }, newValue: "ORD-2026-009" }), label)
        .params.number,
    ).toBe("ORD-2026-009");
  });
});

describe("isPlaceholderOrderNumber / resolveOrderCreatedNumber", () => {
  it("detects pending placeholders and bare UUIDs", () => {
    expect(isPlaceholderOrderNumber("ORD-PENDING-abc")).toBe(true);
    expect(isPlaceholderOrderNumber("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(true);
    expect(isPlaceholderOrderNumber("ORD-2026-015")).toBe(false);
    expect(isPlaceholderOrderNumber("")).toBe(true);
  });

  it("prefers the live order number over a placeholder event snapshot", () => {
    expect(resolveOrderCreatedNumber("ORD-PENDING-x", "ORD-2026-015")).toBe("ORD-2026-015");
    expect(resolveOrderCreatedNumber("ORD-2026-001", "ORD-2026-015")).toBe("ORD-2026-015");
    expect(resolveOrderCreatedNumber("ORD-2026-001", "")).toBe("ORD-2026-001");
    expect(resolveOrderCreatedNumber(null, null)).toBe("—");
  });
});
