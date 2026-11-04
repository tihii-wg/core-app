import { describe, expect, it } from "vitest";
import type { OrderEvent } from "../../services/apiOrderEvents";
import { buildMaterialLineEventPayload, buildServiceLineEventPayload, describeOrderEvent } from "./orderFeed";

const event = (partial: Partial<OrderEvent>): OrderEvent => ({
  id: "e",
  orderId: "o",
  eventType: "status_changed",
  fieldName: "status",
  oldValue: null,
  newValue: null,
  payload: {},
  actorName: null,
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
});
