import { describe, expect, it } from "vitest";
import { minPaidPercentToInput, parseMinPaidPercentInput } from "./minPaidPercentInput";

describe("parseMinPaidPercentInput", () => {
  it("treats empty and zero as no requirement", () => {
    expect(parseMinPaidPercentInput("")).toEqual({ ok: true, value: null });
    expect(parseMinPaidPercentInput("  ")).toEqual({ ok: true, value: null });
    expect(parseMinPaidPercentInput("0")).toEqual({ ok: true, value: null });
  });

  it("parses valid percents (comma decimal supported)", () => {
    expect(parseMinPaidPercentInput("50")).toEqual({ ok: true, value: 50 });
    expect(parseMinPaidPercentInput("33,5")).toEqual({ ok: true, value: 33.5 });
    expect(parseMinPaidPercentInput("100")).toEqual({ ok: true, value: 100 });
  });

  it("rejects out-of-range or non-numeric input", () => {
    expect(parseMinPaidPercentInput("101")).toEqual({ ok: false });
    expect(parseMinPaidPercentInput("-1")).toEqual({ ok: false });
    expect(parseMinPaidPercentInput("abc")).toEqual({ ok: false });
  });
});

describe("minPaidPercentToInput", () => {
  it("maps null to empty and numbers to text", () => {
    expect(minPaidPercentToInput(null)).toBe("");
    expect(minPaidPercentToInput(undefined)).toBe("");
    expect(minPaidPercentToInput(50)).toBe("50");
  });
});
