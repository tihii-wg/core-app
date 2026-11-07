/** CSS px per mm at 96dpi — keep in sync with CanvasDesigner sheet scaling. */
export const CANVAS_MM_TO_PX = 3.7795275591;

/**
 * Zoom percent so an A4 (or other) sheet fits the given container width.
 * Example: 343px available for 210mm A4 → ≈ 43%.
 */
export function computeFitWidthZoomPercent(availableWidthPx: number, sheetWidthMm: number): number {
  if (!(availableWidthPx > 0) || !(sheetWidthMm > 0)) return 100;
  const sheetPx = sheetWidthMm * CANVAS_MM_TO_PX;
  const fit = Math.floor((availableWidthPx / sheetPx) * 100);
  return Math.max(35, Math.min(200, fit));
}

/** True when the sheet at 100% is wider than the container (fit needed). */
export function needsFitWidth(availableWidthPx: number, sheetWidthMm: number): boolean {
  if (!(availableWidthPx > 0) || !(sheetWidthMm > 0)) return false;
  return availableWidthPx < sheetWidthMm * CANVAS_MM_TO_PX;
}
