import type { Order } from "../../lib/types";

export type OrderUnsavedEditSession = {
  isDirty: () => boolean;
  /** Persist current form values. Returns the saved order, or null when validation/save failed. */
  save: () => Promise<Order | null>;
};

const sessions = new Map<string, OrderUnsavedEditSession>();

/** Register the active EditOrderForm (or similar) for an order id. */
export function registerOrderUnsavedEdits(orderId: string, session: OrderUnsavedEditSession) {
  sessions.set(orderId, session);
  return () => {
    if (sessions.get(orderId) === session) sessions.delete(orderId);
  };
}

export function getOrderUnsavedEdits(orderId: string | null | undefined): OrderUnsavedEditSession | null {
  if (!orderId) return null;
  return sessions.get(orderId) ?? null;
}

export function orderHasUnsavedEdits(orderId: string | null | undefined): boolean {
  const session = getOrderUnsavedEdits(orderId);
  return Boolean(session?.isDirty());
}

/** Test-only: clear all registrations. */
export function clearOrderUnsavedEditsForTests() {
  sessions.clear();
}
