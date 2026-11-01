/**
 * Pure FIFO batch consumption (mirrors public.crm_consume_batches_fifo).
 * Used for unit tests and client-side previews — the database remains authoritative.
 */

export type BatchSlice = {
  id: string;
  quantityLeft: number;
  unitCost?: number;
  receivedAt?: string;
  createdAt?: string;
};

export type ConsumedSlice = { batchId: string; quantity: number; unitCost: number };

/** Oldest received_at / created_at / id first. */
export function sortBatchesFifo<T extends BatchSlice>(batches: readonly T[]): T[] {
  return [...batches].sort((a, b) => {
    const ra = a.receivedAt ?? a.createdAt ?? "";
    const rb = b.receivedAt ?? b.createdAt ?? "";
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Consumes `quantity` across batches FIFO.
 * - Empty batches list → [] (legacy path; warehouse_stock still owns the qty).
 * - Some batches but sum(quantityLeft) < quantity → throws.
 * - Never leaves a negative quantityLeft on returned remaining state.
 */
export function consumeBatchesFifo(
  batches: readonly BatchSlice[],
  quantity: number,
): { consumed: ConsumedSlice[]; remaining: BatchSlice[] } {
  if (!(quantity > 0) || !Number.isFinite(quantity)) {
    throw new Error("quantity must be > 0");
  }
  const withStock = batches.filter((batch) => batch.quantityLeft > 0);
  if (withStock.length === 0) return { consumed: [], remaining: batches.map((batch) => ({ ...batch })) };

  const total = withStock.reduce((sum, batch) => sum + batch.quantityLeft, 0);
  if (total < quantity) throw new Error("insufficient_batch_stock");

  const ordered = sortBatchesFifo(withStock);
  const remainingMap = new Map(batches.map((batch) => [batch.id, { ...batch }]));
  const consumed: ConsumedSlice[] = [];
  let left = quantity;

  for (const batch of ordered) {
    if (left <= 0) break;
    const current = remainingMap.get(batch.id)!;
    const take = Math.min(current.quantityLeft, left);
    current.quantityLeft -= take;
    consumed.push({ batchId: batch.id, quantity: take, unitCost: batch.unitCost ?? 0 });
    left -= take;
  }

  if (left > 0) throw new Error("insufficient_batch_stock");
  return { consumed, remaining: [...remainingMap.values()] };
}
