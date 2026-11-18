/**
 * Orders this tab has just written. Realtime echoes of our own writes are skipped: the mutation already
 * refreshed what it changed, and a second wave (orders + clients + inventory + stock …) only slows the UI
 * and wrongly shows «order changed on another device». Changes from other users / tabs still arrive.
 */
const LOCAL_WRITE_TTL_MS = 6_000;
const recentOrderWrites = new Map<string, number>();

export function markLocalOrderWrite(orderId: string | null | undefined) {
  const id = orderId?.trim();
  if (!id) return;
  recentOrderWrites.set(id, Date.now() + LOCAL_WRITE_TTL_MS);
}

export function isRecentLocalOrderWrite(orderId: string | null | undefined): boolean {
  const id = orderId?.trim();
  if (!id) return false;
  const expires = recentOrderWrites.get(id);
  if (expires == null) return false;
  if (expires < Date.now()) {
    recentOrderWrites.delete(id);
    return false;
  }
  return true;
}

/** Order id a realtime row belongs to (orders.id or the child row's order_id). */
export function realtimeRowOrderId(table: string, row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const raw = table === "orders" ? row.id : row.order_id;
  return typeof raw === "string" && raw ? raw : null;
}

/** `orderId` (or `order.id` / `warrantyOrderId`) of a mutation's variables, when it is about one order. */
export function orderIdFromMutationVariables(variables: unknown): string | null {
  if (!variables || typeof variables !== "object") return null;
  const record = variables as Record<string, unknown>;
  for (const key of ["orderId", "warrantyOrderId"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  const order = record.order;
  if (order && typeof order === "object" && typeof (order as { id?: unknown }).id === "string") {
    return (order as { id: string }).id;
  }
  return null;
}

/**
 * Non-order tables (stock, catalog, payments, clients …) have no order id to match, so their echoes are
 * skipped while one of our own writes is running and for a short time after it settles. The write already
 * refreshed what it changed; other users' changes outside this window still arrive normally.
 */
const LOCAL_MUTATION_WINDOW_MS = 3_000;
let inFlightMutations = 0;
let lastMutationSettledAt = 0;

export function noteLocalMutationStart() {
  inFlightMutations += 1;
}

export function noteLocalMutationSettled() {
  inFlightMutations = Math.max(0, inFlightMutations - 1);
  lastMutationSettledAt = Date.now();
}

export function isWithinLocalMutationWindow(): boolean {
  return inFlightMutations > 0 || Date.now() - lastMutationSettledAt < LOCAL_MUTATION_WINDOW_MS;
}
