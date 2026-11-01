import { describe, expect, it } from "vitest";
import { consumeBatchesFifo, sortBatchesFifo } from "./batchFifo";

describe("consumeBatchesFifo", () => {
  it("no-ops when there are no batches (legacy stock path)", () => {
    expect(consumeBatchesFifo([], 5)).toEqual({ consumed: [], remaining: [] });
  });

  it("consumes oldest batch first across multiple batches", () => {
    const { consumed, remaining } = consumeBatchesFifo(
      [
        { id: "b2", quantityLeft: 4, receivedAt: "2026-02-01", unitCost: 2 },
        { id: "b1", quantityLeft: 3, receivedAt: "2026-01-01", unitCost: 1 },
      ],
      5,
    );
    expect(consumed).toEqual([
      { batchId: "b1", quantity: 3, unitCost: 1 },
      { batchId: "b2", quantity: 2, unitCost: 2 },
    ]);
    expect(remaining.find((row) => row.id === "b1")?.quantityLeft).toBe(0);
    expect(remaining.find((row) => row.id === "b2")?.quantityLeft).toBe(2);
  });

  it("rejects when batch total is below the requested quantity", () => {
    expect(() => consumeBatchesFifo([{ id: "b1", quantityLeft: 2, receivedAt: "2026-01-01" }], 3)).toThrow(
      /insufficient_batch_stock/,
    );
  });

  it("never returns negative quantityLeft", () => {
    const { remaining } = consumeBatchesFifo([{ id: "b1", quantityLeft: 2, receivedAt: "2026-01-01" }], 2);
    expect(remaining[0].quantityLeft).toBe(0);
  });
});

describe("sortBatchesFifo", () => {
  it("orders by receivedAt then id", () => {
    const ids = sortBatchesFifo([
      { id: "b", quantityLeft: 1, receivedAt: "2026-01-02" },
      { id: "a", quantityLeft: 1, receivedAt: "2026-01-01" },
      { id: "c", quantityLeft: 1, receivedAt: "2026-01-01" },
    ]).map((row) => row.id);
    expect(ids).toEqual(["a", "c", "b"]);
  });
});
