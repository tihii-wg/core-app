import { pageSizeMm, type CanvasDocumentLayout } from "./types";

/** Same bounds as the layout guard (`guards.ts`). */
export const MIN_PAGE_MARGINS_MM = 0;
export const MAX_PAGE_MARGINS_MM = 50;

export function clampPageMarginsMm(value: number): number {
  if (!Number.isFinite(value)) return MIN_PAGE_MARGINS_MM;
  return Math.min(MAX_PAGE_MARGINS_MM, Math.max(MIN_PAGE_MARGINS_MM, Math.round(value * 10) / 10));
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Changes the page margins and stretches / shrinks every element proportionally to the new content box, so the
 * design keeps its look and fills the new work area (margins 0 → edge to edge of the sheet). Coordinates are in
 * mm from the content-box corner, so without this a smaller margin would only leave empty space right / bottom.
 */
export function rescaleCanvasLayoutToMargins(layout: CanvasDocumentLayout, nextMarginsMm: number): CanvasDocumentLayout {
  const next = clampPageMarginsMm(nextMarginsMm);
  const current = layout.page.marginsMm;
  if (next === current) return layout;
  const { widthMm, heightMm } = pageSizeMm(layout.page.size, layout.page.orientation);
  const oldW = widthMm - 2 * current;
  const oldH = heightMm - 2 * current;
  const newW = widthMm - 2 * next;
  const newH = heightMm - 2 * next;
  if (oldW <= 0 || oldH <= 0 || newW <= 0 || newH <= 0) return { ...layout, page: { ...layout.page, marginsMm: next } };
  const sx = newW / oldW;
  const sy = newH / oldH;
  return {
    ...layout,
    page: { ...layout.page, marginsMm: next },
    elements: layout.elements.map((element) => ({
      ...element,
      xMm: round(element.xMm * sx),
      yMm: round(element.yMm * sy),
      wMm: round(element.wMm * sx),
      hMm: round(element.hMm * sy),
    })),
  };
}
