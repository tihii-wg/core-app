import { describe, expect, it } from "vitest";
import {
  clampBoxToContent,
  contentBoxMm,
  contentMmFromSheetClient,
  sheetMmToContentMm,
} from "./contentBox";

describe("contentBox", () => {
  it("computes content size from page and margins", () => {
    expect(contentBoxMm(210, 297, 10)).toEqual({
      marginsMm: 10,
      contentWidthMm: 190,
      contentHeightMm: 277,
    });
  });

  it("converts sheet mm to content-relative mm", () => {
    expect(sheetMmToContentMm(15, 20, 10)).toEqual({ xMm: 5, yMm: 10 });
  });

  it("converts pointer → content mm with margins and zoom", () => {
    const sheetRect = { left: 100, top: 50 } as DOMRect;
    const mmToPx = 4;
    const scale = 0.5;
    // client at sheet origin + (10mm + 10mm margin) in sheet space at scale
    // sheetXMm = dx / (mmToPx * scale) = 40 / 2 = 20; content = 20 - 10 = 10
    const point = contentMmFromSheetClient(100 + 40, 50 + 40, sheetRect, mmToPx, scale, 10);
    expect(point.xMm).toBe(10);
    expect(point.yMm).toBe(10);
  });

  it("page-center of content is half content width/height", () => {
    const box = contentBoxMm(210, 297, 15);
    expect(box.contentWidthMm / 2).toBe(90);
    expect(box.contentHeightMm / 2).toBe(133.5);
  });

  it("clamps boxes to the content area", () => {
    expect(clampBoxToContent({ xMm: -5, yMm: 300, wMm: 50, hMm: 20 }, 190, 277)).toEqual({
      xMm: 0,
      yMm: 257,
      wMm: 50,
      hMm: 20,
    });
  });
});
