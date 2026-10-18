import { describe, expect, it } from "vitest";
import { remainingToIssue, remainingToReturn, warehouseMaterialStatus } from "./warehouseMaterialStatus";

describe("warehouseMaterialStatus", () => {
  it("derives issue/return remaining and status labels", () => {
    expect(warehouseMaterialStatus({ quantity: 5, quantityIssued: 0, quantityReturned: 0 })).toBe("not_issued");
    expect(warehouseMaterialStatus({ quantity: 5, quantityIssued: 2, quantityReturned: 0 })).toBe("partially_issued");
    expect(warehouseMaterialStatus({ quantity: 5, quantityIssued: 5, quantityReturned: 0 })).toBe("fully_issued");
    expect(warehouseMaterialStatus({ quantity: 5, quantityIssued: 5, quantityReturned: 2 })).toBe("partially_returned");
    expect(warehouseMaterialStatus({ quantity: 5, quantityIssued: 5, quantityReturned: 5 })).toBe("fully_returned");

    expect(remainingToIssue({ quantity: 5, quantityIssued: 3 })).toBe(2);
    expect(remainingToReturn({ quantityIssued: 3, quantityReturned: 1 })).toBe(2);
  });
});
