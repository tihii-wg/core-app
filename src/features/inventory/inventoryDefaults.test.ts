import { describe, expect, it } from "vitest";
import { DEFAULT_INVENTORY_MIN_QUANTITY } from "./inventoryDefaults";

describe("inventoryDefaults", () => {
  it("defaults new inventory minimum stock to 10 units", () => {
    expect(DEFAULT_INVENTORY_MIN_QUANTITY).toBe(10);
  });
});
