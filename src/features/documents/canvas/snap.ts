import type { CanvasElement } from "./types";

export type Guide = { orientation: "h" | "v"; positionMm: number };

const SNAP_THRESHOLD_MM = 1.5;

export function snapValue(value: number, gridMm: number, enabled: boolean): number {
  if (!enabled || gridMm <= 0) return value;
  return Math.round(value / gridMm) * gridMm;
}

/** Snap moving box to grid and to other elements' edges/centers; returns guides. */
export function snapBox(
  box: { xMm: number; yMm: number; wMm: number; hMm: number },
  others: CanvasElement[],
  gridMm: number,
  snapGrid: boolean,
  contentSize?: { contentWidthMm: number; contentHeightMm: number } | null,
): { xMm: number; yMm: number; guides: Guide[] } {
  let x = snapGrid ? snapValue(box.xMm, gridMm, true) : box.xMm;
  let y = snapGrid ? snapValue(box.yMm, gridMm, true) : box.yMm;
  const guides: Guide[] = [];

  const targetsX: number[] = [];
  const targetsY: number[] = [];
  if (contentSize) {
    targetsX.push(0, contentSize.contentWidthMm / 2, contentSize.contentWidthMm);
    targetsY.push(0, contentSize.contentHeightMm / 2, contentSize.contentHeightMm);
  }
  for (const el of others) {
    targetsX.push(el.xMm, el.xMm + el.wMm / 2, el.xMm + el.wMm);
    targetsY.push(el.yMm, el.yMm + el.hMm / 2, el.yMm + el.hMm);
  }

  const candidatesX = [x, x + box.wMm / 2, x + box.wMm];
  const candidatesY = [y, y + box.hMm / 2, y + box.hMm];

  for (const candidate of candidatesX) {
    for (const target of targetsX) {
      if (Math.abs(candidate - target) <= SNAP_THRESHOLD_MM) {
        x += target - candidate;
        guides.push({ orientation: "v", positionMm: target });
      }
    }
  }
  for (const candidate of candidatesY) {
    for (const target of targetsY) {
      if (Math.abs(candidate - target) <= SNAP_THRESHOLD_MM) {
        y += target - candidate;
        guides.push({ orientation: "h", positionMm: target });
      }
    }
  }

  return { xMm: x, yMm: y, guides };
}
