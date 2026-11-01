import type { OrderEvent } from "../../services/apiOrderEvents";

export type OrderEventDescription = {
  /** i18n key under `orders.feed.events`. */
  key: "statusChanged" | "customStatusChanged" | "generic";
  params: Record<string, string>;
};

const EMPTY = "—";

function payloadText(event: OrderEvent, key: string) {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Turns a raw `order_events` row into an i18n key + params. Pure.
 * - `status` changes: values are system order statuses, labelled by `statusLabel`.
 * - `custom_status_id` changes: the names frozen in the payload win; otherwise the value is unknown ("—").
 */
export function describeOrderEvent(event: OrderEvent, statusLabel: (value: string) => string): OrderEventDescription {
  if (event.eventType === "status_changed" && event.fieldName === "custom_status_id") {
    return {
      key: "customStatusChanged",
      params: {
        from: payloadText(event, "old_name") ?? EMPTY,
        to: payloadText(event, "new_name") ?? EMPTY,
      },
    };
  }

  if (event.eventType === "status_changed") {
    return {
      key: "statusChanged",
      params: {
        from: event.oldValue ? statusLabel(event.oldValue) : EMPTY,
        to: event.newValue ? statusLabel(event.newValue) : EMPTY,
      },
    };
  }

  return {
    key: "generic",
    params: {
      type: event.eventType,
      field: event.fieldName ?? "",
      from: event.oldValue ?? EMPTY,
      to: event.newValue ?? EMPTY,
    },
  };
}
