import { describe, expect, it } from "vitest";

/**
 * Mirrors the outstanding quantity rule used by delete_order_with_payments /
 * return_order_materials_to_warehouse:
 *   outstanding = quantity_issued - quantity_returned
 * Only positive outstanding quantities are returned; already-returned stock is left alone.
 */
function outstandingQty(issued: number, returned: number) {
  return Math.max(0, issued - returned);
}

describe("cancelled-order delete material return calculus", () => {
  it("returns nothing when no materials were issued", () => {
    expect(outstandingQty(0, 0)).toBe(0);
  });

  it("returns the full issued qty when nothing was returned yet", () => {
    expect(outstandingQty(5, 0)).toBe(5);
  });

  it("returns only the remaining outstanding after a partial manual return", () => {
    expect(outstandingQty(5, 2)).toBe(3);
  });

  it("returns nothing when everything was already returned manually", () => {
    expect(outstandingQty(4, 4)).toBe(0);
  });

  it("never invents a negative return", () => {
    expect(outstandingQty(2, 5)).toBe(0);
  });
});
