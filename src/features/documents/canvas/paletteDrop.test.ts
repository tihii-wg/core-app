import { describe, expect, it } from "vitest";
import { dropPreviewBoxFromContentPoint } from "./paletteDrop";

describe("dropPreviewBoxFromContentPoint", () => {
  it("snaps and clamps inside the content box with margins math", () => {
    const box = dropPreviewBoxFromContentPoint(
      { xMm: 12.4, yMm: 8.2 },
      { wMm: 60, hMm: 12 },
      190,
      277,
      1,
      true,
    );
    expect(box).not.toBeNull();
    expect(box!.xMm).toBeGreaterThanOrEqual(0);
    expect(box!.yMm).toBeGreaterThanOrEqual(0);
    expect(box!.xMm + box!.wMm).toBeLessThanOrEqual(190);
    expect(box!.yMm + box!.hMm).toBeLessThanOrEqual(277);
  });

  it("cancels when the pointer is outside the sheet content", () => {
    expect(
      dropPreviewBoxFromContentPoint({ xMm: -10, yMm: 10 }, { wMm: 40, hMm: 10 }, 190, 277, 1),
    ).toBeNull();
    expect(
      dropPreviewBoxFromContentPoint({ xMm: 200, yMm: 10 }, { wMm: 40, hMm: 10 }, 190, 277, 1),
    ).toBeNull();
  });
});
