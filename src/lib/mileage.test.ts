import { describe, expect, it } from "vitest";
import {
  MileageParseError,
  assertStoredMileage,
  formatMileageInput,
  mileageValidate,
  parseMileageInput,
} from "./mileage";

const t = ((key: string) => key) as never;

describe("parseMileageInput", () => {
  it("accepts plain digits, grouped spaces, NBSP, dots, commas, and apostrophes", () => {
    expect(parseMileageInput("100 000")).toBe(100_000);
    expect(parseMileageInput("100000")).toBe(100_000);
    expect(parseMileageInput("100\u00A0000")).toBe(100_000);
    expect(parseMileageInput("100.000")).toBe(100_000);
    expect(parseMileageInput("100,000")).toBe(100_000);
    expect(parseMileageInput("1'234'567")).toBe(1_234_567);
    expect(parseMileageInput("1’234’567")).toBe(1_234_567);
    expect(parseMileageInput(" 5 ")).toBe(5);
    expect(parseMileageInput("0")).toBe(0);
    expect(parseMileageInput(45200)).toBe(45200);
  });

  it("returns null for empty input", () => {
    expect(parseMileageInput("")).toBeNull();
    expect(parseMileageInput("   ")).toBeNull();
    expect(parseMileageInput(null)).toBeNull();
    expect(parseMileageInput(undefined)).toBeNull();
  });

  it("rejects decimals, negatives, non-numeric, over-max, and invalid groups", () => {
    expect(() => parseMileageInput("100000,5")).toThrow(MileageParseError);
    expect(() => parseMileageInput("100.5")).toThrow(MileageParseError);
    expect(() => parseMileageInput("-5")).toThrow(MileageParseError);
    expect(() => parseMileageInput("abc")).toThrow(MileageParseError);
    expect(() => parseMileageInput("10 000 000")).toThrow(/mileageTooLarge/);
    expect(() => parseMileageInput("1.23.456")).toThrow(MileageParseError);
    expect(() => parseMileageInput(12.5)).toThrow(MileageParseError);

    try {
      parseMileageInput("100.5");
    } catch (error) {
      expect(error).toBeInstanceOf(MileageParseError);
      expect((error as MileageParseError).i18nKey).toBe("vehicles.validation.mileageInvalid");
    }
    try {
      parseMileageInput("99999999");
    } catch (error) {
      expect((error as MileageParseError).i18nKey).toBe("vehicles.validation.mileageTooLarge");
    }
  });
});

describe("formatMileageInput", () => {
  it("groups by locale and uses a regular space for ru/ro", () => {
    expect(formatMileageInput(100_000, "en-US")).toBe("100,000");
    expect(formatMileageInput(100_000, "ru-RU")).toBe("100 000");
    expect(formatMileageInput(100_000, "ro-RO")).toBe("100 000");
    expect(formatMileageInput(null, "en-US")).toBe("");
  });
});

describe("mileageValidate", () => {
  it("allows empty unless required", () => {
    expect(mileageValidate("", t)).toBe(true);
    expect(mileageValidate("100 000", t)).toBe(true);
    expect(mileageValidate("100.5", t)).toBe("vehicles.validation.mileageInvalid");
    expect(mileageValidate("", t, { required: true })).toBe("vehicles.validation.mileageInvalid");
  });
});

describe("assertStoredMileage", () => {
  it("accepts whole integers in range and rejects fractions", () => {
    expect(assertStoredMileage(null)).toBeNull();
    expect(assertStoredMileage(100_000)).toBe(100_000);
    expect(() => assertStoredMileage(12.5)).toThrow(MileageParseError);
    expect(() => assertStoredMileage(-1)).toThrow(MileageParseError);
  });
});
