/**
 * Stable technical codes for status_definitions.
 * Codes are NOT display names and are NOT derived from system_status uniqueness
 * (many statuses may share the same system_status).
 */

/** Preferred canonical code for a known system_status, or null when none. */
export function preferredCodeFromSystemStatus(systemStatus: string | null | undefined): string | null {
  switch ((systemStatus ?? "").trim()) {
    case "new":
      return "new";
    case "in-progress":
      return "in_progress";
    case "waiting-parts":
      return "waiting_parts";
    case "cancelled":
      return "cancelled";
    case "closed":
      return "closed";
    case "completed":
      return "completed";
    case "paid":
      return "paid";
    default:
      return null;
  }
}

/** Deterministic fallback from immutable status UUID (no hyphens). */
export function fallbackCodeFromStatusId(statusId: string): string {
  const hex = statusId.trim().toLowerCase().replace(/-/g, "");
  return `s_${hex}`;
}

/**
 * Allocates a unique code for one status among siblings in the same workspace+entity.
 * - Keeps existingCode when already set.
 * - Tries preferred (from system_status) once if free.
 * - Otherwise uses UUID fallback (always unique per id).
 */
export function allocateStatusCode(input: {
  statusId: string;
  systemStatus?: string | null;
  existingCode?: string | null;
  takenCodes: ReadonlySet<string>;
}): string {
  const existing = input.existingCode?.trim() || null;
  if (existing) return existing;

  const preferred = preferredCodeFromSystemStatus(input.systemStatus);
  if (preferred && !input.takenCodes.has(preferred)) return preferred;

  return fallbackCodeFromStatusId(input.statusId);
}

/**
 * Idempotent backfill for a workspace/entity batch.
 * Rows already coded keep their codes. Competing preferred codes go to the
 * earliest row by (sortOrder, createdAt, id); others get UUID fallbacks.
 */
export function backfillStatusCodes<
  T extends {
    id: string;
    systemStatus?: string | null;
    code?: string | null;
    sortOrder?: number;
    createdAt?: string | null;
  },
>(rows: readonly T[]): Map<string, string> {
  const result = new Map<string, string>();
  const taken = new Set<string>();

  for (const row of rows) {
    const code = row.code?.trim();
    if (code) {
      result.set(row.id, code);
      taken.add(code);
    }
  }

  const pending = [...rows]
    .filter((row) => !result.has(row.id))
    .sort((a, b) => {
      const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (so !== 0) return so;
      const ca = a.createdAt ?? "";
      const cb = b.createdAt ?? "";
      if (ca !== cb) return ca.localeCompare(cb);
      return a.id.localeCompare(b.id);
    });

  // First pass: claim preferred codes for the earliest pending row only.
  const preferredClaimed = new Set<string>();
  for (const row of pending) {
    const preferred = preferredCodeFromSystemStatus(row.systemStatus);
    if (!preferred || taken.has(preferred) || preferredClaimed.has(preferred)) continue;
    preferredClaimed.add(preferred);
    result.set(row.id, preferred);
    taken.add(preferred);
  }

  // Second pass: everyone else gets UUID fallback.
  for (const row of pending) {
    if (result.has(row.id)) continue;
    const code = allocateStatusCode({
      statusId: row.id,
      systemStatus: row.systemStatus,
      existingCode: null,
      takenCodes: taken,
    });
    result.set(row.id, code);
    taken.add(code);
  }

  return result;
}
