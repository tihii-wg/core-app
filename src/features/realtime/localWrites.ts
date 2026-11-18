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
