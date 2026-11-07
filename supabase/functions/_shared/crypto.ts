/** Pure crypto helpers shared by Edge Functions (Web Crypto; no Deno APIs). */

const encoder = new TextEncoder();

/** Constant-time equality for secrets / tokens of equal length. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i]! ^ right[i]!;
  }
  return diff === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export type OAuthStatePayload = {
  workspaceId: string;
  userId: string;
  exp: number;
  nonce: string;
  locale?: string;
};

/** Sign OAuth state: base64url(payload).base64url(hmac). */
export async function signOAuthState(payload: OAuthStatePayload, secret: string): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${bytesToBase64Url(signature)}`;
}

/** Decode signed state payload when HMAC is valid (ignores expiry). */
export async function peekOAuthState(
  state: string,
  secret: string,
): Promise<OAuthStatePayload | null> {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const key = await hmacKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  const actual = base64UrlToBytes(sig);
  if (expected.length !== actual.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected[i]! ^ actual[i]!;
  if (diff !== 0) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(body));
    const payload = JSON.parse(json) as OAuthStatePayload;
    if (
      typeof payload.workspaceId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.nonce !== "string"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Verify signed state; returns payload or null when invalid / expired. */
export async function verifyOAuthState(
  state: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<OAuthStatePayload | null> {
  const payload = await peekOAuthState(state, secret);
  if (!payload) return null;
  if (payload.exp * 1000 < nowMs) return null;
  return payload;
}

export function oauthStateExpiresAt(nowMs: number = Date.now(), ttlMinutes = 10): number {
  return Math.floor(nowMs / 1000) + ttlMinutes * 60;
}
