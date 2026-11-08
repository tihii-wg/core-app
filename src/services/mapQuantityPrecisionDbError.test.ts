import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { mapQuantityPrecisionDbError } from "./apiOrders";

describe("mapQuantityPrecisionDbError", () => {
  it("maps material / issue / return / catalog precision errors", () => {
    const expected = i18n.t("orders.validation.quantityMaxDecimals");
    expect(mapQuantityPrecisionDbError({ message: "Material quantity may have at most 2 decimal places" })).toBe(expected);
    expect(mapQuantityPrecisionDbError({ message: "Issue quantity may have at most 2 decimal places" })).toBe(expected);
    expect(mapQuantityPrecisionDbError({ message: "Return quantity may have at most 2 decimal places" })).toBe(expected);
    expect(mapQuantityPrecisionDbError({ message: "quantity may have at most 2 decimal places" })).toBe(expected);
  });

  it("ignores unrelated errors", () => {
    expect(mapQuantityPrecisionDbError({ message: "insufficient_stock" })).toBeNull();
    expect(mapQuantityPrecisionDbError({ message: "" })).toBeNull();
    expect(mapQuantityPrecisionDbError(null)).toBeNull();
  });
});
