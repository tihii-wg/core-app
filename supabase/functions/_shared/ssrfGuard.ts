/** Block private / loopback / link-local targets after DNS resolution (SSRF). */

export type SsrfErrorCode = "https_only" | "ssrf_blocked" | "unreachable";

export class SsrfBlockedError extends Error {
  readonly code: SsrfErrorCode;
  constructor(code: SsrfErrorCode, message: string) {
    super(message);
    this.name = "SsrfBlockedError";
    this.code = code;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (normalized.startsWith("fe80:")) return true; // link-local
  // IPv4-mapped ::ffff:x.x.x.x
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

export function assertHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SsrfBlockedError("https_only", "Invalid URL");
  }
  if (url.protocol !== "https:") {
    throw new SsrfBlockedError("https_only", "Only https:// URLs are allowed");
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("ssrf_blocked", "Credentials in URL are not allowed");
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new SsrfBlockedError("ssrf_blocked", "Localhost targets are blocked");
  }
  // Literal IP in hostname
  if (isBlockedIp(host)) {
    throw new SsrfBlockedError("ssrf_blocked", "Private IP targets are blocked");
  }
  return url;
}

/** Resolve A/AAAA and reject if any address is private / loopback / link-local. */
export async function assertPublicHttpsHost(raw: string): Promise<URL> {
  const url = assertHttpsUrl(raw);
  const host = url.hostname;

  // If hostname is already an IP literal, assertHttpsUrl checked it.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    return url;
  }

  const addresses: string[] = [];
  try {
    const a = await Deno.resolveDns(host, "A");
    addresses.push(...a);
  } catch {
    // may be IPv6-only
  }
  try {
    const aaaa = await Deno.resolveDns(host, "AAAA");
    addresses.push(...aaaa);
  } catch {
    // ignore
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError("unreachable", `Could not resolve host ${host}`);
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError("ssrf_blocked", `Host resolves to a private address (${addr})`);
    }
  }
  return url;
}
