import { describe, expect, it } from "vitest";
import { netFromGross, vatIncludedAmount } from "./vat";

describe("vat helpers", () => {
  it("extracts the VAT portion from a tax-included price", () => {
    expect(vatIncludedAmount(13950)).toBe(2325);
    expect(vatIncludedAmount(13950, 20)).toBe(2325);
    expect(vatIncludedAmount(110, 10)).toBe(10);
  });

  it("computes net from gross", () => {
    expect(netFromGross(13950)).toBe(11625);
    expect(netFromGross(13950) + vatIncludedAmount(13950)).toBe(13950);
  });

  it("returns 0 VAT for invalid input or non-positive rate", () => {
    expect(vatIncludedAmount(Number.NaN)).toBe(0);
    expect(vatIncludedAmount(100, 0)).toBe(0);
    expect(netFromGross(100, 0)).toBe(100);
  });
});
