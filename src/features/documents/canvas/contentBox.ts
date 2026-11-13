/** Content-box geometry: stored xMm/yMm are relative to the printable area (inside margins). */

export type ContentBoxMm = {
  marginsMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
};

export function contentBoxMm(
  pageWidthMm: number,
  pageHeightMm: number,
  marginsMm: number,
): ContentBoxMm {
  const m = Math.max(0, marginsMm);
  return {
    marginsMm: m,
    contentWidthMm: Math.max(0, pageWidthMm - m * 2),
    contentHeightMm: Math.max(0, pageHeightMm - m * 2),
  };
}

/** Sheet (full page) mm → content-relative mm. */
export function sheetMmToContentMm(
  xMm: number,
  yMm: number,
  marginsMm: number,
): { xMm: number; yMm: number } {
  return { xMm: xMm - marginsMm, yMm: yMm - marginsMm };
}

/** Clamp a box to the content area (overflow = clipped in print). */
export function clampBoxToContent(
  box: { xMm: number; yMm: number; wMm: number; hMm: number },
  contentWidthMm: number,
  contentHeightMm: number,
): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const wMm = Math.min(Math.max(1, box.wMm), Math.max(1, contentWidthMm));
  const hMm = Math.min(Math.max(1, box.hMm), Math.max(1, contentHeightMm));
  const xMm = Math.min(Math.max(0, box.xMm), Math.max(0, contentWidthMm - wMm));
  const yMm = Math.min(Math.max(0, box.yMm), Math.max(0, contentHeightMm - hMm));
  return { xMm, yMm, wMm, hMm };
}

/** Pointer on the scaled sheet → content-relative mm. */
export function contentMmFromSheetClient(
  clientX: number,
  clientY: number,
  sheetRect: DOMRect,
  mmToPx: number,
  scale: number,
  marginsMm: number,
): { xMm: number; yMm: number } {
  const sheetXMm = (clientX - sheetRect.left) / (mmToPx * scale);
  const sheetYMm = (clientY - sheetRect.top) / (mmToPx * scale);
  return sheetMmToContentMm(sheetXMm, sheetYMm, marginsMm);
}
