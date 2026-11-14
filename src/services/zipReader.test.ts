import { describe, expect, it } from "vitest";
import { readZip, readZipJson } from "./zipReader";
import { parseBackupFile } from "./apiRestore";

/** Builds a ZIP with stored (uncompressed) entries — enough to exercise the reader's parsing. */
function storedZip(files: Record<string, string>): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, eocd] as BlobPart[]);
}

const manifest = {
  format: "core-app-workspace-backup",
  version: 1,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceName: "Sans",
  createdAt: "2026-11-14T10:00:00.000Z",
  tables: [
    { name: "orders", rowCount: 3 },
    { name: "clients", rowCount: 2 },
  ],
  files: 1,
};

describe("readZip", () => {
  it("lists entries and reads stored content", async () => {
    const entries = await readZip(storedZip({ "a.txt": "hello", "dir/b.json": '{"x":1}' }));
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "dir/b.json"]);
    expect(new TextDecoder().decode(await entries[0].read())).toBe("hello");
    expect(await readZipJson(entries, "dir/b.json")).toEqual({ x: 1 });
    expect(await readZipJson(entries, "missing.json")).toBeNull();
  });

  it("rejects non-zip data", async () => {
    await expect(readZip(new Blob(["definitely not a zip archive at all"]))).rejects.toThrow("zip:invalid");
  });
});

describe("parseBackupFile", () => {
  it("reads the manifest, totals and file entries", async () => {
    const blob = storedZip({
      "manifest.json": JSON.stringify(manifest),
      "workspace.json": "{}",
      "data/orders.json": "[]",
      "files/order-attachments/11111111-1111-4111-8111-111111111111/a.jpg": "img",
    });
    const parsed = await parseBackupFile(new File([blob], "backup.zip"));
    expect(parsed.manifest.workspaceName).toBe("Sans");
    expect(parsed.totalRows).toBe(5);
    expect(parsed.hasWorkspaceSettings).toBe(true);
    expect(parsed.fileEntries).toHaveLength(1);
  });

  it("rejects a zip that is not a Core App backup", async () => {
    const blob = storedZip({ "manifest.json": JSON.stringify({ format: "other" }) });
    await expect(parseBackupFile(new File([blob], "x.zip"))).rejects.toMatchObject({ code: "notBackup" });
  });
});
