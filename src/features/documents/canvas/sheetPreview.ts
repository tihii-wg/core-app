/**
 * Screen vs print sheet geometry for canvas (and legacy) template previews.
 * Print keeps `@page` margins; screen uses padding on `.canvas-page` so the iframe
 * shows a full sheet centered on a gray desk.
 */

import type { DocumentTemplate } from "../../../services/apiDocumentTemplates";
import { isDocumentLayout, type PageOrientation, type PageSize } from "../layout";
import { isCanvasDocumentLayout } from "./guards";
import { CANVAS_MM_TO_PX } from "./fitWidthZoom";
import { pageSizeMm, type CanvasDocumentLayout } from "./types";

export type SheetCssSize = {
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
  marginsMm: number;
  size: PageSize;
  orientation: PageOrientation;
};

/** Vertical gap between pages in screen previews (px). */
export const SHEET_GAP_PX = 12;

/** Number of rendered pages in a canvas preview document (for sizing preview iframes). */
export function countCanvasPages(html: string | null | undefined): number {
  if (!html) return 1;
  return Math.max(1, (html.match(/class="canvas-page"/g) ?? []).length);
}

/** Screen-only sheet chrome. Must not affect `@media print` / `@page` positioning. */
export function canvasScreenSheetCss(marginsMm: number): string {
  const m = Math.max(0, marginsMm);
  return (
    `@media screen{` +
    // No outer margins: the iframe is sized to exactly one sheet, so any extra margin causes a
    // scrollbar that steals width and pushes the sheet left. Pages are separated by a bottom gap only.
    `html{scrollbar-width:none;}html::-webkit-scrollbar{display:none;}` +
    `body{margin:0!important;background:#eef0f3;}` +
    `.canvas-page{` +
    `box-sizing:content-box;` +
    `padding:${m}mm;` +
    `margin:0 auto ${SHEET_GAP_PX}px;` +
    `background:#fff;` +
    `box-shadow:0 1px 4px rgba(0,0,0,.15);` +
    `}` +
    `}`
  );
}

export function canvasPageCssWithScreenPreview(
  layout: CanvasDocumentLayout,
  fontFamilyCss?: string,
): string {
  const size = layout.page.size === "A5" ? "A5" : "A4";
  const font = fontFamilyCss ? `font-family:${fontFamilyCss};` : "";
  const print =
    `@page{size:${size} ${layout.page.orientation};margin:${layout.page.marginsMm}mm}` +
    `body{${font}margin:0;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
  return `${print}${canvasScreenSheetCss(layout.page.marginsMm)}`;
}

/** Full sheet CSS px for thumbnails / preview iframes. */
export function sheetCssSizeForTemplate(template: DocumentTemplate): SheetCssSize {
  if (template.layout && isCanvasDocumentLayout(template.layout)) {
    const { widthMm, heightMm } = pageSizeMm(template.layout.page.size, template.layout.page.orientation);
    return {
      widthMm,
      heightMm,
      widthPx: widthMm * CANVAS_MM_TO_PX,
      heightPx: heightMm * CANVAS_MM_TO_PX,
      marginsMm: template.layout.page.marginsMm,
      size: template.layout.page.size,
      orientation: template.layout.page.orientation,
    };
  }
  if (template.layout && isDocumentLayout(template.layout)) {
    const size = template.layout.page.size === "A5" ? "A5" : "A4";
    const orientation = template.layout.page.orientation === "landscape" ? "landscape" : "portrait";
    const { widthMm, heightMm } = pageSizeMm(size, orientation);
    return {
      widthMm,
      heightMm,
      widthPx: widthMm * CANVAS_MM_TO_PX,
      heightPx: heightMm * CANVAS_MM_TO_PX,
      marginsMm: template.layout.page.marginsMm,
      size,
      orientation,
    };
  }
  const widthMm = template.widthMm && template.widthMm > 0 ? template.widthMm : 210;
  const heightMm = template.heightMm && template.heightMm > 0 ? template.heightMm : 297;
  return {
    widthMm,
    heightMm,
    widthPx: widthMm * CANVAS_MM_TO_PX,
    heightPx: heightMm * CANVAS_MM_TO_PX,
    marginsMm: 0,
    size: widthMm <= 150 ? "A5" : "A4",
    orientation: widthMm > heightMm ? "landscape" : "portrait",
  };
}

/** Scale that fits the sheet inside a thumb box (letterbox). */
export function fitSheetScale(
  sheet: { widthPx: number; heightPx: number },
  boxW: number,
  boxH: number,
): number {
  if (sheet.widthPx <= 0 || sheet.heightPx <= 0) return 1;
  return Math.min(boxW / sheet.widthPx, boxH / sheet.heightPx);
}

/** Legacy (non-canvas) screen wrapper: center body content on an A4-like white sheet. */
export function legacyScreenSheetCss(widthMm: number, heightMm: number): string {
  return (
    `@media screen{` +
    `html{scrollbar-width:none;}html::-webkit-scrollbar{display:none;}` +
    `body{margin:0!important;background:#eef0f3;display:flex;justify-content:center;padding:0;}` +
    `body>div,body>.legacy-sheet{` +
    `box-sizing:border-box;` +
    `width:${widthMm}mm;` +
    `min-height:${heightMm}mm;` +
    `margin:0 auto;` +
    `padding:10mm;` +
    `background:#fff;` +
    `box-shadow:0 1px 4px rgba(0,0,0,.15);` +
    `}` +
    `}`
  );
}
