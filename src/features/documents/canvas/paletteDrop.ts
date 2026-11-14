/**
 * Palette drop preview math (content-box mm). Used by CanvasDesigner and unit tests.
 */

import { clampBoxToContent } from "./contentBox";
import { snapValue } from "./snap";

export type DropPreviewBox = { xMm: number; yMm: number; wMm: number; hMm: number };

/**
 * Converts a pointer position in content mm into a snapped, clamped drop box.
 * Returns null when the pointer is outside the content area (with a small tolerance).
 */
export function dropPreviewBoxFromContentPoint(
  point: { xMm: number; yMm: number },
  size: { wMm: number; hMm: number },
  contentWidthMm: number,
  contentHeightMm: number,
  gridMm: number,
  snap = true,
): DropPreviewBox | null {
  if (
    point.xMm < -2 ||
    point.yMm < -2 ||
    point.xMm > contentWidthMm + 2 ||
    point.yMm > contentHeightMm + 2
  ) {
    return null;
  }
  const grabOffsetX = Math.min(8, size.wMm / 3);
  const grabOffsetY = Math.min(4, size.hMm / 3);
  return clampBoxToContent(
    {
      xMm: snapValue(point.xMm - grabOffsetX, gridMm, snap),
      yMm: snapValue(point.yMm - grabOffsetY, gridMm, snap),
      wMm: size.wMm,
      hMm: size.hMm,
    },
    contentWidthMm,
    contentHeightMm,
  );
}
