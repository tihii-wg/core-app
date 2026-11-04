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

/** Deterministic base fallback from immutable status UUID (no hyphens). */
export function fallbackCodeFromStatusId(statusId: string): string {
  const hex = statusId.trim().toLowerCase().replace(/-/g, "");
  return `s_${hex}`;
}

/**
 * Next free code among siblings. Tries `base`, then `base_2`, `base_3`, …
 * Deterministic and collision-safe — never assume UUID fallback is free.
 */
export function nextAvailableCode(base: string, takenCodes: ReadonlySet<string>): string {
  const root = base.trim();
  if (!root) throw new Error("status code base is required");
  if (!takenCodes.has(root)) return root;
  let n = 2;
  for (;;) {
    const candidate = `${root}_${n}`;
    if (!takenCodes.has(candidate)) return candidate;
    n += 1;
    if (n > 10_000) throw new Error("status code allocation exhausted");
  }
}

/**
 * Allocates a unique code for one status among siblings in the same workspace+entity.
 * - Keeps existingCode when already set and unique among taken (caller repairs dupes first).
 * - Tries preferred (from system_status) once if free.
 * - Otherwise uses UUID fallback with collision counter.
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

  return nextAvailableCode(fallbackCodeFromStatusId(input.statusId), input.takenCodes);
}

function sortKey(a: { sortOrder?: number; createdAt?: string | null; id: string }, b: typeof a) {
  const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  if (so !== 0) return so;
  const ca = a.createdAt ?? "";
  const cb = b.createdAt ?? "";
  if (ca !== cb) return ca.localeCompare(cb);
  return a.id.localeCompare(b.id);
}

/**
 * Idempotent backfill for a workspace/entity batch.
 * - Duplicate existing codes: earliest keeper retains; others get UUID fallbacks.
 * - NULL codes: preferred if free, else UUID fallback with counter.
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

  const byCode = new Map<string, T[]>();
  for (const row of rows) {
    const code = row.code?.trim();
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(row);
    byCode.set(code, list);
  }

  for (const [code, holders] of byCode) {
    const ordered = [...holders].sort(sortKey);
    const keeper = ordered[0];
    result.set(keeper.id, code);
    taken.add(code);
  }

  // Losers of duplicate codes + NULL-code rows.
  const pending = [...rows]
    .filter((row) => !result.has(row.id))
    .sort(sortKey);

  const preferredClaimed = new Set<string>();
  for (const row of pending) {
    const preferred = preferredCodeFromSystemStatus(row.systemStatus);
    if (!preferred || taken.has(preferred) || preferredClaimed.has(preferred)) continue;
    preferredClaimed.add(preferred);
    result.set(row.id, preferred);
    taken.add(preferred);
  }

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

/** True when a Postgres unique violation is specifically the status code index. */
export function isStatusCodeUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error || error.code !== "23505") return false;
  const msg = error.message ?? "";
  return /status_definitions_code_uidx|\(workspace_id,\s*entity,\s*code\)|Key \(workspace_id, entity, code\)/i.test(msg);
}
