/**
 * Client-side photo compression before upload.
 *
 * Re-encodes large photos as JPEG (respecting EXIF orientation), shrinking the
 * longest side and lowering quality step by step until the file fits `maxBytes`.
 * Files that are already small enough are returned unchanged. Formats the browser
 * cannot decode are returned unchanged — callers decide whether the original size is
 * acceptable. HEIC/HEIF is always converted to JPEG (natively in Safari, otherwise via
 * the lazily loaded heic2any library).
 */

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Longest side for the first attempt; plenty for documentation photos. */
const START_MAX_SIDE = 3000;
const MIN_SIDE = 800;
const QUALITIES = [0.85, 0.75, 0.65, 0.55];

const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export type CompressImageResult = {
  file: File;
  /** True when the returned file is a re-encoded copy. */
  compressed: boolean;
  /** True when the browser could not decode the image (returned as-is). */
  undecodable: boolean;
};

function jpegName(name: string) {
  const base = name.replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.jpg`;
}

async function decode(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

function isHeic(file: File, type: string) {
  return HEIC_TYPES.has(type) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * HEIC/HEIF → JPEG with the heic2any library (WASM, loaded lazily only for HEIC files),
 * for browsers that cannot decode HEIC themselves (Chrome/Edge/Firefox on desktop).
 */
async function heicToJpeg(file: File): Promise<File | null> {
  try {
    const { default: heic2any } = await import("heic2any");
    const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(result) ? result[0] : result;
    if (!blob) return null;
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return null;
  }
}

export async function compressImageToMaxBytes(
  file: File,
  mimeType: string,
  maxBytes: number = PHOTO_MAX_BYTES,
): Promise<CompressImageResult> {
  const type = (mimeType || file.type || "").toLowerCase();
  const heic = isHeic(file, type);
  if (!heic && (!COMPRESSIBLE_TYPES.has(type) || file.size <= maxBytes)) {
    return { file, compressed: false, undecodable: false };
  }

  // HEIC is always converted to JPEG (most browsers cannot show HEIC previews),
  // even when it is already small enough.
  let bitmap = await decode(file);
  if (!bitmap && heic) {
    const jpeg = await heicToJpeg(file);
    if (!jpeg) return { file, compressed: false, undecodable: true };
    if (jpeg.size <= maxBytes) return { file: jpeg, compressed: true, undecodable: false };
    file = jpeg;
    bitmap = await decode(jpeg);
  }
  if (!bitmap) return { file, compressed: false, undecodable: true };

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, compressed: false, undecodable: true };

    let maxSide = Math.min(START_MAX_SIDE, Math.max(bitmap.width, bitmap.height));
    let best: Blob | null = null;

    while (maxSide >= MIN_SIDE) {
      const scale = maxSide / Math.max(bitmap.width, bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // JPEG has no alpha: paint white under transparent PNG/WebP areas.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of QUALITIES) {
        const blob = await canvasToBlob(canvas, quality);
        if (!blob) continue;
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= maxBytes) {
          return {
            file: new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() }),
            compressed: true,
            undecodable: false,
          };
        }
      }
      maxSide = Math.round(maxSide * 0.75);
    }

    if (best && best.size < file.size) {
      return {
        file: new File([best], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() }),
        compressed: true,
        undecodable: false,
      };
    }
    return { file, compressed: false, undecodable: false };
  } finally {
    bitmap.close?.();
  }
}
