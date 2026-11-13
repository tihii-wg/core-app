/** Production-allowed idle timeout minutes (null = feature off). */
export const SESSION_IDLE_TIMEOUT_VALUES = [30, 60, 120, 240, 480, 720, 1440] as const;

export type SessionIdleTimeoutMinutes = (typeof SESSION_IDLE_TIMEOUT_VALUES)[number];

/** Dev-only shorter option for manual checks (not in DB CHECK — never persist to production). */
export const SESSION_IDLE_TIMEOUT_DEV_MINUTE = 1 as const;

export const SESSION_IDLE_WARNING_LEAD_MS = 60_000;
export const SESSION_IDLE_ACTIVITY_THROTTLE_MS = 15_000;
export const SESSION_IDLE_CHECK_INTERVAL_MS = 15_000;

export const SESSION_IDLE_LOGOUT_NOTICE_KEY = "core-app:idle-logout-notice";
export const SESSION_IDLE_ACTIVITY_STORAGE_PREFIX = "core-app:session-idle:last-activity:";

export function sessionIdleActivityStorageKey(userId: string) {
  return `${SESSION_IDLE_ACTIVITY_STORAGE_PREFIX}${userId}`;
}

/** Fresh login: start the idle clock now (a stale value from an earlier session must not log out immediately). */
export function rememberSessionIdleActivity(userId: string, at = Date.now()) {
  try {
    localStorage.setItem(sessionIdleActivityStorageKey(userId), String(at));
  } catch {
    // private mode
  }
}

/** Any sign-out: forget idle clocks so the next login starts fresh. */
export function clearSessionIdleActivity() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SESSION_IDLE_ACTIVITY_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

export function sessionIdleBroadcastChannelName(userId: string) {
  return `core-app:session-idle:${userId}`;
}

/** Values shown in settings (includes 1 min only in DEV). */
export function sessionIdleTimeoutSelectValues(isDev = import.meta.env.DEV): Array<number | null> {
  if (isDev) return [null, SESSION_IDLE_TIMEOUT_DEV_MINUTE, ...SESSION_IDLE_TIMEOUT_VALUES];
  return [null, ...SESSION_IDLE_TIMEOUT_VALUES];
}

export function isAllowedSessionIdleTimeoutMinutes(
  value: unknown,
  opts?: { allowDevMinute?: boolean },
): value is SessionIdleTimeoutMinutes | typeof SESSION_IDLE_TIMEOUT_DEV_MINUTE {
  if (value == null) return false;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return false;
  if ((SESSION_IDLE_TIMEOUT_VALUES as readonly number[]).includes(n)) return true;
  return Boolean(opts?.allowDevMinute && n === SESSION_IDLE_TIMEOUT_DEV_MINUTE);
}

/** Normalize DB/API values; unknown → null (off). Dev minute only when allowDevMinute. */
export function normalizeSessionIdleTimeoutMinutes(
  value: unknown,
  opts?: { allowDevMinute?: boolean },
): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const minutes = Math.trunc(n);
  if (isAllowedSessionIdleTimeoutMinutes(minutes, opts)) return minutes;
  return null;
}

/** Strictest (smallest) non-null timeout across memberships; null if all off. */
export function effectiveSessionIdleTimeoutMinutes(
  timeouts: Array<number | null | undefined>,
): number | null {
  let min: number | null = null;
  for (const raw of timeouts) {
    const value = normalizeSessionIdleTimeoutMinutes(raw, { allowDevMinute: true });
    if (value == null) continue;
    min = min == null ? value : Math.min(min, value);
  }
  return min;
}

export function sessionIdleExpiresAtMs(lastActivityAt: number, timeoutMinutes: number): number {
  return lastActivityAt + timeoutMinutes * 60_000;
}

export function sessionIdleRemainingMs(
  lastActivityAt: number,
  now: number,
  timeoutMinutes: number,
): number {
  return Math.max(0, sessionIdleExpiresAtMs(lastActivityAt, timeoutMinutes) - now);
}

export function isSessionIdleExpired(
  lastActivityAt: number,
  now: number,
  timeoutMinutes: number,
): boolean {
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now) || timeoutMinutes <= 0) return false;
  return now >= sessionIdleExpiresAtMs(lastActivityAt, timeoutMinutes);
}

/** Warning lead is 60s, or the full timeout when shorter (e.g. 1-min DEV). */
export function sessionIdleWarningLeadMs(timeoutMinutes: number): number {
  const timeoutMs = timeoutMinutes * 60_000;
  return Math.min(SESSION_IDLE_WARNING_LEAD_MS, Math.max(0, timeoutMs));
}

export function shouldShowSessionIdleWarning(
  lastActivityAt: number,
  now: number,
  timeoutMinutes: number,
): boolean {
  if (isSessionIdleExpired(lastActivityAt, now, timeoutMinutes)) return false;
  const remaining = sessionIdleRemainingMs(lastActivityAt, now, timeoutMinutes);
  return remaining <= sessionIdleWarningLeadMs(timeoutMinutes);
}

export function sessionIdleCountdownSeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}
