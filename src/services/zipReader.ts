/**
 * Minimal ZIP reader for backup archives (stored + deflate entries), using the browser's
 * DecompressionStream("deflate-raw"). Entries are read lazily so large archives are not inflated at once.
 */

export type ZipEntry = {
  name: string;
  compressedSize: number;
  size: number;
  read: () => Promise<Uint8Array>;
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("zip:unsupported_browser");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size;
  if (size < 22) throw new Error("zip:invalid");
  const tailStart = Math.max(0, size - 65_557);
  const tail = new DataView(await blob.slice(tailStart, size).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip:invalid");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > size) throw new Error("zip:invalid");

  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CENTRAL) throw new Error("zip:invalid");
    const method = cd.getUint16(p + 10, true);
    const compressedSize = cd.getUint32(p + 20, true);
    const uncompressed = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;

    entries.push({
      name,
      compressedSize,
      size: uncompressed,
      read: async () => {
        const header = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
        if (header.getUint32(0, true) !== LOCAL) throw new Error("zip:invalid");
        const start = localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const raw = new Uint8Array(await blob.slice(start, start + compressedSize).arrayBuffer());
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error("zip:unsupported_method");
      },
    });
  }
  return entries;
}

export async function readZipJson<T>(entries: ZipEntry[], name: string): Promise<T | null> {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  return JSON.parse(new TextDecoder().decode(await entry.read())) as T;
}
