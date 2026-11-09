import { signAwsV4Request } from "./awsSigV4.ts";
import { assertPublicHttpsHost, SsrfBlockedError } from "./ssrfGuard.ts";

export type NasProtocol = "webdav" | "s3";

export type NasCredential =
  | { type: "webdav"; password: string }
  | { type: "s3"; access_key_id: string; secret_access_key: string };

export type NasConnectionConfig = {
  protocol: NasProtocol;
  baseUrl: string;
  rootPath: string;
  username?: string | null;
  bucket?: string | null;
  region?: string | null;
};

export type NasErrorCode =
  | "unreachable"
  | "tls"
  | "auth_failed"
  | "forbidden"
  | "not_found"
  | "timeout"
  | "https_only"
  | "ssrf_blocked"
  | "invalid_args";

export class NasClientError extends Error {
  readonly code: NasErrorCode;
  constructor(code: NasErrorCode, message: string) {
    super(message);
    this.name = "NasClientError";
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function normalizeRootPath(raw: string | null | undefined): string {
  let path = (raw ?? "/CoreApp").trim() || "/CoreApp";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+/g, "/").replace(/\/$/, "") || "/CoreApp";
  return path;
}

export function joinNasPath(...parts: string[]): string {
  const joined = parts
    .map((p, i) => {
      const s = p.replace(/\\/g, "/");
      if (i === 0) return s.replace(/\/+$/, "");
      return s.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function basicAuthHeader(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // No redirects: a redirect could point to a private address (SSRF) or leak Basic auth.
    const res = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
    if (res.status >= 300 && res.status < 400) {
      throw new NasClientError("unreachable", `NAS redirected (HTTP ${res.status}); use the final https:// address`);
    }
    return res;
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new NasClientError("timeout", "NAS request timed out");
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (/certificate|TLS|SSL|CERT/i.test(msg)) {
      throw new NasClientError("tls", msg);
    }
    throw new NasClientError("unreachable", msg || "NAS unreachable");
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpStatus(status: number): never {
  if (status === 401) throw new NasClientError("auth_failed", "Authentication failed");
  if (status === 403) throw new NasClientError("forbidden", "Access forbidden");
  if (status === 404) throw new NasClientError("not_found", "Path not found");
  throw new NasClientError("unreachable", `NAS returned HTTP ${status}`);
}

export async function assertNasUrlSafe(baseUrl: string): Promise<URL> {
  try {
    return await assertPublicHttpsHost(baseUrl);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw new NasClientError(error.code, error.message);
    }
    throw error;
  }
}

// —— WebDAV ——

function webdavUrl(base: URL, path: string): string {
  const basePath = base.pathname.replace(/\/+$/, "");
  const full = joinNasPath(basePath || "/", path);
  return `${base.origin}${full}`;
}

export async function webdavMkcol(base: URL, path: string, username: string, password: string) {
  const url = webdavUrl(base, path.endsWith("/") ? path : `${path}/`);
  const res = await fetchWithTimeout(url, {
    method: "MKCOL",
    headers: { Authorization: basicAuthHeader(username, password) },
  });
  // 201 created, 405 already exists (common)
  if (res.status === 201 || res.status === 405 || res.status === 409) return;
  if (!res.ok) mapHttpStatus(res.status);
}

export async function webdavEnsureDir(base: URL, path: string, username: string, password: string) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    await webdavMkcol(base, current, username, password);
  }
}

export async function webdavPut(
  base: URL,
  path: string,
  bytes: Uint8Array,
  mimeType: string,
  username: string,
  password: string,
) {
  const url = webdavUrl(base, path);
  const res = await fetchWithTimeout(url, {
    method: "PUT",
    headers: {
      Authorization: basicAuthHeader(username, password),
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!res.ok) mapHttpStatus(res.status);
}

export async function webdavGet(base: URL, path: string, username: string, password: string) {
  const url = webdavUrl(base, path);
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { Authorization: basicAuthHeader(username, password) },
  });
  if (!res.ok) mapHttpStatus(res.status);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}

export async function webdavDelete(base: URL, path: string, username: string, password: string) {
  const url = webdavUrl(base, path.endsWith("/") ? path : path);
  const res = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: { Authorization: basicAuthHeader(username, password) },
  });
  if (res.status === 404) return;
  if (!res.ok) mapHttpStatus(res.status);
}

export async function webdavPropfind(base: URL, path: string, username: string, password: string) {
  const url = webdavUrl(base, path.endsWith("/") ? path : `${path}/`);
  const res = await fetchWithTimeout(url, {
    method: "PROPFIND",
    headers: {
      Authorization: basicAuthHeader(username, password),
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`,
  });
  if (res.status === 207 || res.status === 200) return;
  if (!res.ok) mapHttpStatus(res.status);
}

// —— S3 ——

function s3ObjectUrl(base: URL, bucket: string, key: string): URL {
  // Path-style: https://endpoint/bucket/key
  const cleanKey = key.replace(/^\/+/, "");
  const path = `/${encodeURIComponent(bucket)}/${cleanKey.split("/").map(encodeURIComponent).join("/")}`;
  return new URL(path, `${base.origin}/`);
}

export async function s3PutObject(opts: {
  base: URL;
  bucket: string;
  region: string;
  key: string;
  bytes: Uint8Array;
  mimeType: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const url = s3ObjectUrl(opts.base, opts.bucket, opts.key);
  const headers = await signAwsV4Request({
    method: "PUT",
    url,
    region: opts.region,
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    body: opts.bytes,
    extraHeaders: { "content-type": opts.mimeType || "application/octet-stream" },
  });
  const res = await fetchWithTimeout(url.toString(), {
    method: "PUT",
    headers: { ...headers, "Content-Type": opts.mimeType || "application/octet-stream" },
    body: opts.bytes,
  });
  if (!res.ok) mapHttpStatus(res.status);
}

export async function s3GetObject(opts: {
  base: URL;
  bucket: string;
  region: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const url = s3ObjectUrl(opts.base, opts.bucket, opts.key);
  const headers = await signAwsV4Request({
    method: "GET",
    url,
    region: opts.region,
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    body: null,
  });
  const res = await fetchWithTimeout(url.toString(), { method: "GET", headers });
  if (!res.ok) mapHttpStatus(res.status);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

export async function s3DeleteObject(opts: {
  base: URL;
  bucket: string;
  region: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const url = s3ObjectUrl(opts.base, opts.bucket, opts.key);
  const headers = await signAwsV4Request({
    method: "DELETE",
    url,
    region: opts.region,
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    body: null,
  });
  const res = await fetchWithTimeout(url.toString(), { method: "DELETE", headers });
  if (res.status === 404) return;
  if (!res.ok) mapHttpStatus(res.status);
}

/** Probe NAS: create root, write + delete a test object. */
export async function testNasConnection(
  config: NasConnectionConfig,
  credential: NasCredential,
): Promise<void> {
  const base = await assertNasUrlSafe(config.baseUrl);
  const root = normalizeRootPath(config.rootPath);
  const probeName = `.coreapp-probe-${crypto.randomUUID().slice(0, 8)}.txt`;
  const probeBytes = new TextEncoder().encode("core-app-nas-ok");

  if (config.protocol === "webdav") {
    if (credential.type !== "webdav") throw new NasClientError("invalid_args", "WebDAV password required");
    const username = (config.username ?? "").trim();
    if (!username) throw new NasClientError("invalid_args", "WebDAV username required");
    const password = credential.password;
    if (!password) throw new NasClientError("invalid_args", "WebDAV password required");

    try {
      await webdavPropfind(base, root, username, password);
    } catch (error) {
      if (error instanceof NasClientError && error.code === "not_found") {
        await webdavEnsureDir(base, root, username, password);
        await webdavPropfind(base, root, username, password);
      } else {
        throw error;
      }
    }
    const probePath = joinNasPath(root, probeName);
    await webdavPut(base, probePath, probeBytes, "text/plain", username, password);
    await webdavDelete(base, probePath, username, password);
    return;
  }

  if (credential.type !== "s3") throw new NasClientError("invalid_args", "S3 credentials required");
  const bucket = (config.bucket ?? "").trim();
  if (!bucket) throw new NasClientError("invalid_args", "S3 bucket required");
  const region = (config.region ?? "us-east-1").trim() || "us-east-1";
  const key = joinNasPath(root, probeName).replace(/^\//, "");
  await s3PutObject({
    base,
    bucket,
    region,
    key,
    bytes: probeBytes,
    mimeType: "text/plain",
    accessKeyId: credential.access_key_id,
    secretAccessKey: credential.secret_access_key,
  });
  await s3DeleteObject({
    base,
    bucket,
    region,
    key,
    accessKeyId: credential.access_key_id,
    secretAccessKey: credential.secret_access_key,
  });
}

export function parseNasCredential(raw: string): NasCredential {
  const parsed = JSON.parse(raw) as NasCredential;
  if (parsed?.type === "webdav" && typeof parsed.password === "string") return parsed;
  if (
    parsed?.type === "s3" &&
    typeof parsed.access_key_id === "string" &&
    typeof parsed.secret_access_key === "string"
  ) {
    return parsed;
  }
  throw new NasClientError("invalid_args", "Invalid NAS credential shape");
}
