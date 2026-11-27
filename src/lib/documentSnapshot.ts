/**
 * Phone "save" for printed documents: the browser print dialog cannot save to the gallery and on many phones
 * (home-screen app, in-app browsers) cannot save a PDF either. The rendered document is drawn into a canvas
 * (SVG foreignObject — no library) and saved as JPEG pages or as a PDF made of those pages.
 */

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const RENDER_SCALE = 2;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Images inside an SVG image are not fetched by the browser: they must be data URLs already. */
async function inlineImages(doc: Document) {
  const images = [...doc.images].filter((image) => image.src && !image.src.startsWith("data:"));
  await Promise.all(
    images.map(async (image) => {
      try {
        const response = await fetch(image.src, { mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error(String(response.status));
        image.src = await blobToDataUrl(await response.blob());
      } catch {
        image.remove(); // A logo that cannot be read would leave the whole picture empty.
      }
    }),
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("render failed"));
    image.src = src;
  });
}

/** Draws the document shown in `frame` (already loaded) into a canvas at its full height. */
export async function renderFrameToCanvas(frame: HTMLIFrameElement): Promise<HTMLCanvasElement> {
  const source = frame.contentDocument;
  if (!source?.documentElement) throw new Error("document not ready");
  const width = Math.ceil(source.documentElement.scrollWidth || frame.clientWidth);
  // Content height, not the frame's: scrollHeight is never less than the frame itself,
  // which would add an empty page under a short document.
  const contentHeight = Math.max(
    source.documentElement.getBoundingClientRect().height,
    source.body?.getBoundingClientRect().bottom ?? 0,
  );
  const height = Math.ceil(contentHeight || source.documentElement.scrollHeight);

  // Work on a copy: the visible preview stays untouched.
  const copy = document.implementation.createHTMLDocument("");
  copy.replaceChild(copy.importNode(source.documentElement, true), copy.documentElement);
  copy.querySelectorAll("script").forEach((node) => node.remove());
  await inlineImages(copy);
  const xhtml = new XMLSerializer().serializeToString(copy.documentElement);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

  const canvas = document.createElement("canvas");
  canvas.width = width * RENDER_SCALE;
  canvas.height = height * RENDER_SCALE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(RENDER_SCALE, RENDER_SCALE);
  // Safari decodes embedded images lazily: a second pass draws what the first one missed.
  context.drawImage(image, 0, 0, width, height);
  await new Promise((resolve) => window.setTimeout(resolve, 60));
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

/** True when a page has nothing but (near) white pixels, checked on a small copy. */
function isBlank(page: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 60;
  probe.height = 85;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(page, 0, 0, probe.width, probe.height);
  const { data } = context.getImageData(0, 0, probe.width, probe.height);
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) return false;
  }
  return true;
}

/** A4-proportioned slices of a tall canvas (one per page). */
function pageSlices(canvas: HTMLCanvasElement): HTMLCanvasElement[] {
  const pageHeight = Math.round(canvas.width * (A4_HEIGHT_PT / A4_WIDTH_PT));
  const slices: HTMLCanvasElement[] = [];
  for (let top = 0; top < canvas.height; top += pageHeight) {
    const sliceHeight = Math.min(pageHeight, canvas.height - top);
    // A sliver left over by rounding is not a page.
    if (sliceHeight < 8 && slices.length > 0) break;
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = pageHeight;
    const context = page.getContext("2d");
    if (!context) continue;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, page.width, page.height);
    context.drawImage(canvas, 0, top, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    if (slices.length > 0 && isBlank(page)) continue;
    slices.push(page);
  }
  return slices;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("jpeg failed"))), "image/jpeg", quality),
  );
}

/** Minimal PDF: one A4 page per JPEG (DCTDecode image filling the page). */
async function jpegPagesToPdf(pages: { jpeg: Uint8Array; width: number; height: number }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%âãÏÓ\n");
  const pageIds = pages.map((_, index) => 3 + index * 3);
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const draw = `q ${A4_WIDTH_PT} 0 0 ${A4_HEIGHT_PT} 0 0 cm /Im0 Do Q`;
    object(pageId, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    object(imageId, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      push(page.jpeg);
      push("\nendstream");
    });
    object(contentId, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });

  const xrefOffset = length;
  const count = 3 + pages.length * 3;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

export async function documentPdf(frame: HTMLIFrameElement): Promise<Blob> {
  const slices = pageSlices(await renderFrameToCanvas(frame));
  const pages = await Promise.all(
    slices.map(async (slice) => ({
      jpeg: new Uint8Array(await (await canvasToJpeg(slice)).arrayBuffer()),
      width: slice.width,
      height: slice.height,
    })),
  );
  return jpegPagesToPdf(pages);
}

/** One JPEG per A4 page (the gallery takes pictures, not PDFs). */
export async function documentImages(frame: HTMLIFrameElement): Promise<Blob[]> {
  const slices = pageSlices(await renderFrameToCanvas(frame));
  return Promise.all(slices.map((slice) => canvasToJpeg(slice)));
}

/**
 * Hands files to the phone: the share sheet ("Save image" → gallery, "Save to Files", messengers) where the
 * browser can share files, otherwise ordinary downloads.
 */
export function canShareFiles(files: File[]): boolean {
  return typeof navigator.share === "function" && Boolean(navigator.canShare?.({ files }));
}

/**
 * Opens the system share sheet (Save to Photos / Save to Files) or downloads the files.
 * "blocked" means the browser refused the share because the tap that started it is too
 * old (Safari after a long render): call again from a fresh tap with the same files.
 */
export async function saveFiles(
  files: File[],
  title: string,
): Promise<"shared" | "downloaded" | "cancelled" | "blocked"> {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files, title });
      return "shared";
    } catch (error) {
      const name = (error as Error).name;
      if (name === "AbortError") return "cancelled";
      if (name === "NotAllowedError") return "blocked";
      // Any other share failure: fall back to downloads.
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return "downloaded";
}
