import { describe, expect, it } from "vitest";
import { buildCanvasBoxStyle, canvasAlignWrapperHtml } from "./canvasElementStyle";
import type { CanvasElementStyle } from "./types";

const baseStyle = (patch: Partial<CanvasElementStyle> = {}): CanvasElementStyle => ({
  fontSizePt: 12,
  color: "#111111",
  align: "center",
  paddingMm: 1,
  ...patch,
});

describe("buildCanvasBoxStyle", () => {
  it("uses pt for font size in both CSS and React styles", () => {
    const result = buildCanvasBoxStyle(baseStyle({ fontSizePt: 14 }), null);
    expect(result.outerCss).toContain("font-size:14pt");
    expect(result.reactStyle.fontSize).toBe("14pt");
  });

  it("wraps for verticalAlign middle/bottom so text-align can apply on the inner", () => {
    const middle = buildCanvasBoxStyle(baseStyle({ verticalAlign: "middle", align: "center" }), null);
    expect(middle.wrapForAlign).toBe(true);
    expect(middle.outerCss).toContain("display:flex");
    expect(middle.outerCss).toContain("justify-content:center");
    expect(middle.outerCss).not.toContain("text-align:center");
    expect(middle.reactStyle.justifyContent).toBe("center");
    expect(canvasAlignWrapperHtml("Hi", "center")).toContain("text-align:center");

    const bottom = buildCanvasBoxStyle(baseStyle({ verticalAlign: "bottom", align: "right" }), null);
    expect(bottom.wrapForAlign).toBe(true);
    expect(bottom.outerCss).toContain("justify-content:flex-end");
  });

  it("keeps text-align on the outer box when verticalAlign is top", () => {
    const top = buildCanvasBoxStyle(baseStyle({ align: "right" }), null);
    expect(top.wrapForAlign).toBe(false);
    expect(top.outerCss).toContain("text-align:right");
  });

  it("applies radiusMm", () => {
    const result = buildCanvasBoxStyle(baseStyle({ radiusMm: 2.5 }), null);
    expect(result.outerCss).toContain("border-radius:2.5mm");
    expect(result.reactStyle.borderRadius).toBe("2.5mm");
  });
});
