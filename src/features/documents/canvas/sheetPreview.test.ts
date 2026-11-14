import { describe, expect, it } from "vitest";
import type { DocumentTemplate } from "../../../services/apiDocumentTemplates";
import { defaultCanvasLayoutForType } from "./defaultCanvasLayouts";
import {
  canvasPageCssWithScreenPreview,
  canvasScreenSheetCss,
  fitSheetScale,
  sheetCssSizeForTemplate,
} from "./sheetPreview";
import type { CanvasDocumentLayout } from "./types";

function canvasTemplate(layout: CanvasDocumentLayout): DocumentTemplate {
  return {
    id: "t1",
    workspaceId: "ws",
    name: "T",
    documentType: "work_order",
    widthMm: null,
    heightMm: null,
    showCents: true,
    isAvailableToAll: true,
    isActive: true,
    isDefault: true,
    layout,
    style: null,
    bodyHtml: "",
  };
}

describe("sheetPreview", () => {
  it("sizes A4 portrait / A5 / landscape from template page", () => {
    const a4 = defaultCanvasLayoutForType("work_order");
    a4.page = { ...a4.page, size: "A4", orientation: "portrait", marginsMm: 10 };
    expect(sheetCssSizeForTemplate(canvasTemplate(a4))).toMatchObject({
      widthMm: 210,
      heightMm: 297,
      marginsMm: 10,
    });

    const a5 = structuredClone(a4);
    a5.page = { ...a5.page, size: "A5", orientation: "portrait" };
    expect(sheetCssSizeForTemplate(canvasTemplate(a5))).toMatchObject({ widthMm: 148, heightMm: 210 });

    const landscape = structuredClone(a4);
    landscape.page = { ...landscape.page, size: "A4", orientation: "landscape" };
    expect(sheetCssSizeForTemplate(canvasTemplate(landscape))).toMatchObject({
      widthMm: 297,
      heightMm: 210,
    });
  });

  it("fits sheet scale to both width and height", () => {
    const scale = fitSheetScale({ widthPx: 794, heightPx: 1123 }, 120, 170);
    expect(scale).toBeLessThanOrEqual(120 / 794);
    expect(scale).toBeLessThanOrEqual(170 / 1123);
    expect(794 * scale).toBeLessThanOrEqual(120 + 0.01);
    expect(1123 * scale).toBeLessThanOrEqual(170 + 0.01);
  });

  it("screen CSS draws margins outside the content box and does not alter @page margins", () => {
    const layout = defaultCanvasLayoutForType("invoice");
    layout.page.marginsMm = 15;
    const css = canvasPageCssWithScreenPreview(layout);
    expect(css).toContain("@page{size:A4 portrait;margin:15mm}");
    expect(css).toContain("@media screen");
    // Margins drawn outside the content box (absolute elements ignore padding).
    expect(css).toContain("margin:15mm 0 calc(15mm + 12px)");
    expect(css).toContain("box-shadow:0 0 0 15mm #fff");
    expect(css).not.toContain("padding:15mm");
    expect(canvasScreenSheetCss(15)).not.toContain("@page");
    // Print media must not get the screen sheet rules applied as a global style.
    expect(css).not.toMatch(/@media print[^}]*margin:15mm 0/);
  });

  it("centers legacy sheets on A4 when no canvas layout", () => {
    const legacy: DocumentTemplate = {
      id: "legacy",
      workspaceId: "ws",
      name: "Legacy",
      documentType: "act",
      widthMm: null,
      heightMm: null,
      showCents: true,
      isAvailableToAll: true,
      isActive: true,
      isDefault: false,
      layout: null,
      style: null,
      bodyHtml: "<p>hi</p>",
    };
    expect(sheetCssSizeForTemplate(legacy)).toMatchObject({ widthMm: 210, heightMm: 297 });
  });
});
