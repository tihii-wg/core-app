import { fallbackLanguage, isAppLanguage, languageFromPath, type AppLanguage } from "../../i18n/languages";

/** Normalize arbitrary locale input to a supported app language. */
export function normalizeRecoveryLocale(locale: string | null | undefined): AppLanguage {
  return isAppLanguage(locale) ? locale : fallbackLanguage;
}

/** Locale-aware path for the password reset page (recovery email redirect target). */
export function passwordResetPath(locale: string) {
  return `/${normalizeRecoveryLocale(locale)}/reset-password`;
}

/**
 * Absolute redirect URL for `resetPasswordForEmail` using the current browser origin.
 * Never returns the site root alone — always includes `/{locale}/reset-password`.
 */
export function passwordResetRedirectUrl(locale: string) {
  if (typeof window === "undefined" || !window.location?.origin || window.location.origin === "null") {
    throw new Error("Password recovery redirect URL requires a browser origin.");
  }
  const path = passwordResetPath(locale);
  const url = `${window.location.origin}${path}`;
  // Guard against accidental root-only redirects.
  if (url === window.location.origin || url === `${window.location.origin}/`) {
    throw new Error("Password recovery redirect URL must include the reset-password path.");
  }
  return url;
}

/**
 * Persists the Auth user id that completed `PASSWORD_RECOVERY` (never tokens/passwords).
 * Survives refresh for the same user; must match the current session user to authorize the form.
 */
export const PASSWORD_RECOVERY_FLAG_KEY = "coreapp-password-recovery";

/** In-memory fallback when sessionStorage is unavailable (lost on full reload). */
let memoryRecoveryUserId: string | null = null;

/**
 * Confirms recovery only after Supabase emits `PASSWORD_RECOVERY` with a session.
 * Do not call this based on URL `code` / `type=recovery` alone.
 */
export function confirmPasswordRecovery(userId: string) {
  const id = userId.trim();
  if (!id) return;
  memoryRecoveryUserId = id;
  try {
    sessionStorage.setItem(PASSWORD_RECOVERY_FLAG_KEY, id);
  } catch {
    // Private mode — live PASSWORD_RECOVERY + memory still authorize until reload.
  }
}

export function clearPasswordRecoveryFlag() {
  memoryRecoveryUserId = null;
  try {
    sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG_KEY);
  } catch {
    // ignore
  }
}

export function getConfirmedRecoveryUserId(): string | null {
  try {
    const stored = sessionStorage.getItem(PASSWORD_RECOVERY_FLAG_KEY);
    if (stored) return stored;
  } catch {
    // fall through to memory
  }
  return memoryRecoveryUserId;
}

/** True only when a confirmed recovery marker matches this Auth user id. */
export function isConfirmedRecoveryForUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getConfirmedRecoveryUserId() === userId;
}

/**
 * Drops a marker that belongs to a different user than the current session.
 * Returns true if a stale marker was cleared.
 */
export function clearStalePasswordRecoveryMarker(currentUserId: string | null | undefined): boolean {
  const marked = getConfirmedRecoveryUserId();
  if (!marked) return false;
  if (currentUserId && marked === currentUserId) return false;
  clearPasswordRecoveryFlag();
  return true;
}

function paramsFromLocation(search = window.location.search, hash = window.location.hash) {
  const searchParams = new URLSearchParams(search);
  const hashBody = hash.startsWith("#") ? hash.slice(1) : hash;
  const hashParams = new URLSearchParams(hashBody);
  return { searchParams, hashParams };
}

/** Auth callback `type` from query or hash (e.g. recovery, signup). */
export function authCallbackType(search = window.location.search, hash = window.location.hash): string {
  const { searchParams, hashParams } = paramsFromLocation(search, hash);
  return (hashParams.get("type") ?? searchParams.get("type") ?? "").toLowerCase();
}

/**
 * Heuristic: URL *may* be a recovery callback. Never treat this as a confirmed recovery session.
 * Detects `type=recovery` on any path, or a PKCE `code` once already on the reset route.
 */
export function urlIndicatesPasswordRecovery(search = window.location.search, hash = window.location.hash, pathname = window.location.pathname) {
  if (authCallbackType(search, hash) === "recovery") return true;
  const { searchParams, hashParams } = paramsFromLocation(search, hash);
  if ((searchParams.get("code") || hashParams.get("code")) && /\/reset-password\/?$/.test(pathname)) {
    return true;
  }
  return false;
}

/**
 * Synchronously moves a recovery callback that landed on Site URL / login onto the reset route
 * while preserving query + hash so Supabase can still parse tokens/code.
 * Must run before React Router redirects `/` → `/en/login`.
 */
export function ensurePasswordRecoveryCallbackPath(): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, search, hash } = window.location;
  if (/\/reset-password\/?$/.test(pathname)) return false;
  if (authCallbackType(search, hash) !== "recovery") return false;

  const locale = languageFromPath(pathname);
  const next = `${passwordResetPath(locale)}${search}${hash}`;
  window.history.replaceState(window.history.state, document.title, next);
  return true;
}

/** Human-readable Auth callback error from query/hash, if any (no tokens). */
export function readAuthCallbackError(): string | null {
  const { searchParams, hashParams } = paramsFromLocation();
  const code = hashParams.get("error_code") ?? searchParams.get("error_code");
  const error = hashParams.get("error") ?? searchParams.get("error");
  const description = hashParams.get("error_description") ?? searchParams.get("error_description");
  if (!code && !error && !description) return null;
  return (description || code || error || "error").replace(/\+/g, " ");
}

export function isExpiredRecoveryError(message: string) {
  const text = message.toLowerCase();
  return text.includes("expired") || text.includes("otp_expired") || text.includes("flow_state_expired");
}
