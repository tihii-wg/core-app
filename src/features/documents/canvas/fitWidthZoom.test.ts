import { describe, expect, it } from "vitest";
import { computeFitWidthZoomPercent, needsFitWidth } from "./fitWidthZoom";

describe("computeFitWidthZoomPercent", () => {
  it("fits a 210mm A4 sheet into a 343px phone content width (~43%)", () => {
    expect(computeFitWidthZoomPercent(343, 210)).toBe(43);
  });

  it("reports that a wide container does not need auto-fit", () => {
    expect(needsFitWidth(900, 210)).toBe(false);
    expect(computeFitWidthZoomPercent(900, 210)).toBeGreaterThanOrEqual(100);
  });

  it("needs fit when the container is narrower than the sheet at 100%", () => {
    expect(needsFitWidth(343, 210)).toBe(true);
  });
});
