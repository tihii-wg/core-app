/**
 * Own pictures for print templates (e.g. a rectangular logo): the file is downscaled in the browser and kept in
 * the template layout as a data:image/… URL, so printing needs no storage access and the picture keeps its
 * original proportions (the company logo in settings is cropped to a square).
 */

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** Longest side after downscaling — sharp enough for print at logo sizes, small enough for the layout JSON. */
const MAX_SIDE_PX = 1200;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type TemplateImage = { dataUrl: string; widthPx: number; heightPx: number };

export class TemplateImageError extends Error {
  constructor(public readonly kind: "invalid" | "read") {
    super(kind);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new TemplateImageError("read"));
    image.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new TemplateImageError("read"));
    reader.readAsDataURL(file);
  });
}

export async function templateImageFromFile(file: File): Promise<TemplateImage> {
  if (!ALLOWED.has(file.type) || file.size <= 0 || file.size > MAX_INPUT_BYTES) throw new TemplateImageError("invalid");
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!(width > 0 && height > 0)) throw new TemplateImageError("read");
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  // Small enough already → keep the original bytes (no quality loss).
  if (scale === 1 && file.size <= 300 * 1024) return { dataUrl: original, widthPx: width, heightPx: height };
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const context = canvas.getContext("2d");
  if (!context) throw new TemplateImageError("read");
  context.drawImage(image, 0, 0, targetW, targetH);
  // PNG keeps transparency and crisp edges of logos; JPEG photos stay JPEG.
  const dataUrl =
    file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
  return { dataUrl, widthPx: targetW, heightPx: targetH };
}

/** Height (mm) that keeps the picture's proportions for the given width. */
export function heightForImageRatio(widthMm: number, image: { widthPx: number; heightPx: number }): number {
  if (!(image.widthPx > 0 && image.heightPx > 0)) return widthMm;
  return Math.max(1, Math.round((widthMm * image.heightPx) / image.widthPx * 2) / 2);
}
