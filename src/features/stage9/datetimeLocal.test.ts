import { describe, expect, it } from "vitest";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "./datetimeLocal";

describe("datetime-local helpers", () => {
  it("round-trips through local time", () => {
    const iso = fromDatetimeLocalValue("2026-11-02T14:30");
    expect(iso).not.toBeNull();
    expect(toDatetimeLocalValue(iso)).toBe("2026-11-02T14:30");
  });

  it("returns empty/null for blank or invalid input", () => {
    expect(fromDatetimeLocalValue("")).toBeNull();
    expect(fromDatetimeLocalValue("nope")).toBeNull();
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue("nope")).toBe("");
  });
});
