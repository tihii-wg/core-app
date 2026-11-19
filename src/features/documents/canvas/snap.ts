import type { CanvasElement } from "./types";

export type Guide = { orientation: "h" | "v"; positionMm: number };

const SNAP_THRESHOLD_MM = 1.5;

export function snapValue(value: number, gridMm: number, enabled: boolean): number {
  if (!enabled || gridMm <= 0) return value;
  return Math.round(value / gridMm) * gridMm;
}

type ContentSize = { contentWidthMm: number; contentHeightMm: number };

/** Content edges / centre and every other element's edges / centre along one axis. */
function snapTargets(axis: "x" | "y", others: CanvasElement[], contentSize?: ContentSize | null): number[] {
  const targets: number[] = [];
  if (contentSize) {
    const size = axis === "x" ? contentSize.contentWidthMm : contentSize.contentHeightMm;
    targets.push(0, size / 2, size);
  }
  for (const el of others) {
    const start = axis === "x" ? el.xMm : el.yMm;
    const length = axis === "x" ? el.wMm : el.hMm;
    targets.push(start, start + length / 2, start + length);
  }
  return targets;
}

/** Closest target to any of the candidate points (within the threshold): the offset to apply, or null. */
function bestSnap(candidates: number[], targets: number[]): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;
  for (const candidate of candidates) {
    for (const target of targets) {
      const delta = target - candidate;
      if (Math.abs(delta) <= SNAP_THRESHOLD_MM && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, target };
      }
    }
  }
  return best;
}

/**
 * Snap a moving box: per axis, the single closest match of its start / centre / end to the content edges /
 * centre or another element's edges / centre wins (so a block lands exactly on the page edge); only when nothing
 * is close does it fall back to the grid. (Applying every match in turn shifted the box twice.)
 */
export function snapBox(
  box: { xMm: number; yMm: number; wMm: number; hMm: number },
  others: CanvasElement[],
  gridMm: number,
  snapGrid: boolean,
  contentSize?: ContentSize | null,
): { xMm: number; yMm: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const snapX = bestSnap([box.xMm, box.xMm + box.wMm / 2, box.xMm + box.wMm], snapTargets("x", others, contentSize));
  const snapY = bestSnap([box.yMm, box.yMm + box.hMm / 2, box.yMm + box.hMm], snapTargets("y", others, contentSize));
  let x = box.xMm;
  let y = box.yMm;
  if (snapX) {
    x += snapX.delta;
    guides.push({ orientation: "v", positionMm: snapX.target });
  } else if (snapGrid) {
    x = snapValue(x, gridMm, true);
  }
  if (snapY) {
    y += snapY.delta;
    guides.push({ orientation: "h", positionMm: snapY.target });
  } else if (snapGrid) {
    y = snapValue(y, gridMm, true);
  }
  return { xMm: x, yMm: y, guides };
}

/**
 * Snap one moving edge while resizing (absolute position in content mm): to the content edges / centre or
 * another element's edges / centre when close, else to the grid. Snapping the edge — not the width — lets an
 * element that starts off the grid still end exactly on the page edge.
 */
export function snapEdge(
  positionMm: number,
  axis: "x" | "y",
  others: CanvasElement[],
  gridMm: number,
  contentSize?: ContentSize | null,
): { positionMm: number; guide: Guide | null } {
  const snap = bestSnap([positionMm], snapTargets(axis, others, contentSize));
  if (snap) return { positionMm: snap.target, guide: { orientation: axis === "x" ? "v" : "h", positionMm: snap.target } };
  return { positionMm: snapValue(positionMm, gridMm, true), guide: null };
}
