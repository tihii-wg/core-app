import { describe, expect, it } from "vitest";
import { parseMarkupPercent, sellingPriceFromMarkup } from "./markup";

describe("inventory markup", () => {
  it("adds the markup percentage to the purchase price", () => {
    expect(sellingPriceFromMarkup(100, 20)).toBe(120);
    expect(sellingPriceFromMarkup(10.5, 10)).toBe(11.55);
    expect(sellingPriceFromMarkup(100, 0)).toBe(100);
  });

  it("leaves the selling price empty when the purchase price is empty", () => {
    expect(sellingPriceFromMarkup(null, 20)).toBeNull();
  });

  it("accepts a zero markup and rejects a negative one", () => {
    expect(parseMarkupPercent("20")).toBe(20);
    expect(parseMarkupPercent("0")).toBe(0);
    expect(parseMarkupPercent("")).toBeNull();
    expect(parseMarkupPercent("-5")).toBeNull();
    expect(parseMarkupPercent("abc")).toBeNull();
    expect(parseMarkupPercent("1001")).toBeNull();
  });
});
