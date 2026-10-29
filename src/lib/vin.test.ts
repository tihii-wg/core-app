import { describe, expect, it } from "vitest";
import { assertValidOptionalVin, isValidOptionalVin, normalizeVin, optionalVinValidate } from "./vin";

describe("vin", () => {
  it("normalizes trim and uppercase", () => {
    expect(normalizeVin("  abc123  ")).toBe("ABC123");
    expect(normalizeVin(null)).toBe("");
    expect(normalizeVin(undefined)).toBe("");
  });

  it("allows empty optional VIN", () => {
    expect(isValidOptionalVin("")).toBe(true);
    expect(isValidOptionalVin("   ")).toBe(true);
    expect(assertValidOptionalVin("")).toBe(null);
    expect(optionalVinValidate("", "bad")).toBe(true);
  });

  it("accepts a valid 17-character VIN", () => {
    const vin = "1HGBH41JXMN109186";
    expect(isValidOptionalVin(vin)).toBe(true);
    expect(assertValidOptionalVin(` ${vin.toLowerCase()} `)).toBe(vin);
  });

  it("rejects wrong length without truncating", () => {
    expect(isValidOptionalVin("ABC123")).toBe(false);
    expect(isValidOptionalVin("1HGBH41JXMN109186EXTRA")).toBe(false);
    expect(() => assertValidOptionalVin("ABC123")).toThrow(/17/);
  });

  it("rejects I, O, and Q", () => {
    expect(isValidOptionalVin("IHGBH41JXMN109186")).toBe(false);
    expect(isValidOptionalVin("OHGBH41JXMN109186")).toBe(false);
    expect(isValidOptionalVin("QHGBH41JXMN109186")).toBe(false);
  });

  it("rejects non-alphanumeric characters", () => {
    expect(isValidOptionalVin("1HGBH41JXMN10918-")).toBe(false);
    expect(isValidOptionalVin("1HGBH41JXMN10918 ")).toBe(false);
  });
});
