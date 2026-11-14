import i18n from "../i18n";
import supabase from "./supabase";
import { readZip, readZipJson, type ZipEntry } from "./zipReader";

export type BackupManifestInfo = {
  format: string;
  version: number;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  tables: { name: string; rowCount: number }[];
  files: number;
  warnings?: string[];
};

export type ParsedBackup = {
  manifest: BackupManifestInfo;
  entries: ZipEntry[];
  hasWorkspaceSettings: boolean;
  totalRows: number;
  fileEntries: ZipEntry[];
};

export type RestoreProgress =
  | { stage: "reading" }
  | { stage: "data" }
  | { stage: "files"; done: number; total: number; failed: number }
  | { stage: "finishing" };

export type RestoreResult = {
  workspaceId: string;
  restored: Record<string, number>;
  skipped: Record<string, string>;
  filesTotal: number;
  filesDone: number;
  filesFailed: number;
};

export class RestoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RestoreError";
    this.code = code;
  }
}

const RESTORE_ERROR_CODES = [
  "generic",
  "notZip",
  "notBackup",
  "unsupportedBrowser",
  "unauthorized",
  "owner_only",
  "foreign_reference",
  "invalid_backup",
  "unavailable",
  "restore_failed",
] as const;
type RestoreErrorCode = (typeof RESTORE_ERROR_CODES)[number];

function restoreError(code: string) {
  const known: RestoreErrorCode = (RESTORE_ERROR_CODES as readonly string[]).includes(code)
    ? (code as RestoreErrorCode)
    : "generic";
  return new RestoreError(code, i18n.t(`settings.backups.restore.errors.${known}`));
}

export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  let entries: ZipEntry[];
  try {
    entries = await readZip(file);
  } catch (error) {
    if (error instanceof Error && error.message === "zip:unsupported_browser") throw restoreError("unsupportedBrowser");
    throw restoreError("notZip");
  }
  let manifest: BackupManifestInfo | null = null;
  try {
    manifest = await readZipJson<BackupManifestInfo>(entries, "manifest.json");
  } catch {
    manifest = null;
  }
  if (!manifest || manifest.format !== "core-app-workspace-backup" || manifest.version !== 1 || !manifest.workspaceId) {
    throw restoreError("notBackup");
  }
  const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
  return {
    manifest: { ...manifest, tables },
    entries,
    hasWorkspaceSettings: entries.some((e) => e.name === "workspace.json"),
    totalRows: tables.reduce((sum, t) => sum + (Number(t.rowCount) || 0), 0),
    fileEntries: entries.filter((e) => e.name.startsWith("files/")),
  };
}

async function accessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw restoreError("unauthorized");
  return data.session.access_token;
}

function functionUrl(route: string, query?: Record<string, string>) {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (!base) throw restoreError("generic");
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  return `${base}/functions/v1/workspace-restore/${route}${qs}`;
}

function headers(token: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
    ...extra,
  };
}

async function failFromResponse(res: Response): Promise<never> {
  let code = res.status === 404 ? "unavailable" : "generic";
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    if (body?.error?.code && body.error.code !== "not_found") code = body.error.code;
  } catch {
    // keep status-based code
  }
  if (res.status === 404 && code === "generic") code = "unavailable";
  throw restoreError(code);
}

async function gzipJson(value: unknown): Promise<{ body: BodyInit; gzip: boolean }> {
  const text = JSON.stringify(value);
  if (typeof CompressionStream === "undefined") return { body: text, gzip: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(stream).blob(), gzip: true };
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  txt: "text/plain",
  json: "application/json",
};

function mimeFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Restores a parsed backup into a new workspace; data in one transaction, then files one by one. */
export async function restoreBackup(
  parsed: ParsedBackup,
  name: string,
  onProgress: (progress: RestoreProgress) => void,
): Promise<RestoreResult> {
  onProgress({ stage: "reading" });
  const tables: Record<string, unknown[]> = {};
  for (const entry of parsed.entries) {
    const match = /^data\/([a-z_][a-z0-9_]*)\.json$/.exec(entry.name);
    if (!match) continue;
    const rows = JSON.parse(new TextDecoder().decode(await entry.read())) as unknown;
    if (Array.isArray(rows)) tables[match[1]] = rows;
  }
  const workspace = await readZipJson<Record<string, unknown>>(parsed.entries, "workspace.json").catch(() => null);

  onProgress({ stage: "data" });
  const token = await accessToken();
  const payload = await gzipJson({
    manifest: parsed.manifest,
    workspace,
    tables,
    files: parsed.fileEntries.map((e) => e.name),
    name,
  });
  const res = await fetch(functionUrl("data"), {
    method: "POST",
    headers: headers(token, {
      "Content-Type": "application/json",
      ...(payload.gzip ? { "x-body-encoding": "gzip" } : {}),
    }),
    body: payload.body,
  });
  if (!res.ok) await failFromResponse(res);
  const data = (await res.json()) as {
    jobId: string;
    workspaceId: string;
    restored: Record<string, number>;
    skipped: Record<string, string>;
    filesTotal: number;
    fileKeys: string[];
  };

  let done = 0;
  let failed = 0;
  const total = data.fileKeys.length;
  if (total > 0) onProgress({ stage: "files", done, total, failed });
  for (const key of data.fileKeys) {
    const entry = parsed.fileEntries.find((e) => e.name === `files/${key}`);
    try {
      if (!entry) throw new Error("missing");
      const bytes = await entry.read();
      const fileToken = await accessToken();
      const upload = await fetch(functionUrl("file", { job: data.jobId, key }), {
        method: "POST",
        headers: headers(fileToken, { "Content-Type": mimeFor(key) }),
        body: new Blob([bytes as BlobPart]),
      });
      if (!upload.ok) throw new Error(String(upload.status));
      done += 1;
    } catch {
      failed += 1;
    }
    onProgress({ stage: "files", done, total, failed });
  }

  onProgress({ stage: "finishing" });
  const finishToken = await accessToken();
  await fetch(functionUrl("finish"), {
    method: "POST",
    headers: headers(finishToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ jobId: data.jobId }),
  }).catch(() => undefined);

  return {
    workspaceId: data.workspaceId,
    restored: data.restored,
    skipped: data.skipped,
    filesTotal: total,
    filesDone: done,
    filesFailed: failed,
  };
}
