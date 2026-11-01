import { describe, expect, it } from "vitest";
import type { OrderEvent } from "../../services/apiOrderEvents";
import { describeOrderEvent } from "./orderFeed";

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

  it("uses names frozen in the payload for custom statuses", () => {
    expect(
      describeOrderEvent(event({ fieldName: "custom_status_id", oldValue: "id1", newValue: "id2", payload: { old_name: "QA", new_name: " Ready " } }), label),
    ).toEqual({ key: "customStatusChanged", params: { from: "QA", to: "Ready" } });
    expect(describeOrderEvent(event({ fieldName: "custom_status_id", oldValue: "id1" }), label).params).toEqual({ from: "—", to: "—" });
  });

  it("falls back to a generic description for other event types", () => {
    expect(describeOrderEvent(event({ eventType: "field_changed", fieldName: "deadline", oldValue: "a", newValue: "b" }), label)).toEqual({
      key: "generic",
      params: { type: "field_changed", field: "deadline", from: "a", to: "b" },
    });
  });
});
