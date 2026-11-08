import { describe, expect, it } from "vitest";
import { formatQuantity, parseQuantity, roundQuantity } from "./quantity";

describe("parseQuantity", () => {
  it("accepts comma and dot decimals", () => {
    expect(parseQuantity("2,5")).toBe(2.5);
    expect(parseQuantity("2.5")).toBe(2.5);
    expect(parseQuantity(" 2,50 ")).toBe(2.5);
    expect(parseQuantity(2.5)).toBe(2.5);
  });

  it("rejects empty, zero, and more than 2 decimals", () => {
    expect(parseQuantity("")).toBe("required");
    expect(parseQuantity("   ")).toBe("required");
    expect(parseQuantity(0)).toBe("min");
    expect(parseQuantity("-1")).toBe("min");
    expect(parseQuantity("2.555")).toBe("maxDecimals");
    expect(parseQuantity("1,234")).toBe("maxDecimals");
  });

  it("keeps whole numbers and two-decimal values", () => {
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("2.50")).toBe(2.5);
    expect(parseQuantity("0.01")).toBe(0.01);
  });
});

describe("formatQuantity", () => {
  it("drops trailing zeros and uses locale decimal separator", () => {
    expect(formatQuantity(2, "en")).toBe("2");
    expect(formatQuantity(2.5, "en")).toBe("2.5");
    expect(formatQuantity(2.5, "ru")).toBe("2,5");
    expect(formatQuantity(2.5, "ro")).toBe("2,5");
    expect(formatQuantity(2.5, "en-US")).toBe("2.5");
  });

  it("rounds display to 2 decimals without forcing trailing zeros", () => {
    expect(formatQuantity(roundQuantity(1.2), "en")).toBe("1.2");
    expect(formatQuantity(0, "en")).toBe("0");
  });
});
