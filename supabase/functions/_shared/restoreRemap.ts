/** Pure helpers for restoring a workspace backup into a new workspace (no Deno APIs — unit-testable). */

export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RESTORE_BUCKETS = ["order-attachments", "workspace"] as const;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_EXACT.test(value);
}

/**
 * Old id → new id for every row `id` in the backup plus the workspace itself.
 * Only uuid ids are remapped; other keys (composites, integers) are handled in SQL.
 */
export function buildIdMap(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  tables: Record<string, unknown[]>,
  newId: () => string,
): Map<string, string> {
  const map = new Map<string, string>();
  map.set(sourceWorkspaceId.toLowerCase(), targetWorkspaceId);
  for (const rows of Object.values(tables)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && typeof row === "object" && isUuid((row as Record<string, unknown>).id)) {
        const id = ((row as Record<string, unknown>).id as string).toLowerCase();
        if (!map.has(id)) map.set(id, newId());
      }
    }
  }
  return map;
}

/** Replaces every mapped uuid inside a string (plain ids, storage paths, ids inside text/json). */
export function remapString(value: string, map: Map<string, string>, foreign?: Set<string>): string {
  return value.replace(UUID_RE, (match) => {
    const mapped = map.get(match.toLowerCase());
    if (mapped) return mapped;
    foreign?.add(match.toLowerCase());
    return match;
  });
}

/** Deep copy of a JSON value with uuids remapped; unmapped uuids are collected into `foreign`. */
export function remapValue(value: unknown, map: Map<string, string>, foreign: Set<string>): unknown {
  if (typeof value === "string") return remapString(value, map, foreign);
  if (Array.isArray(value)) return value.map((item) => remapValue(item, map, foreign));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = remapValue(item, map, foreign);
    return out;
  }
  return value;
}

export type RemappedBackup = {
  tables: Record<string, unknown[]>;
  workspace: Record<string, unknown> | null;
  fileMap: Record<string, string>;
  foreignUuids: string[];
};

/**
 * Remaps a parsed backup. `files` are archive keys "files/<bucket>/<path>" (or "<bucket>/<path>").
 * Only files of the allowed buckets under the source workspace folder are kept.
 */
export function remapBackup(input: {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  tables: Record<string, unknown[]>;
  workspace: Record<string, unknown> | null;
  files: string[];
  newId: () => string;
}): RemappedBackup {
  const map = buildIdMap(input.sourceWorkspaceId, input.targetWorkspaceId, input.tables, input.newId);
  const foreign = new Set<string>();
  const tables: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(input.tables)) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name) || !Array.isArray(rows)) continue;
    tables[name] = rows.map((row) => remapValue(row, map, foreign));
  }
  const workspace = input.workspace ? (remapValue(input.workspace, map, new Set()) as Record<string, unknown>) : null;

  const fileMap: Record<string, string> = {};
  const sourcePrefix = `${input.sourceWorkspaceId.toLowerCase()}/`;
  for (const raw of input.files) {
    const key = raw.replace(/^files\//, "");
    const slash = key.indexOf("/");
    if (slash <= 0) continue;
    const bucket = key.slice(0, slash);
    const path = key.slice(slash + 1);
    if (!(RESTORE_BUCKETS as readonly string[]).includes(bucket)) continue;
    if (!path.toLowerCase().startsWith(sourcePrefix) || path.includes("..")) continue;
    fileMap[key] = remapString(path, map);
  }

  return { tables, workspace, fileMap, foreignUuids: [...foreign] };
}
