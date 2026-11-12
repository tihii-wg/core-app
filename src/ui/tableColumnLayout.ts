/** Persisted column order + widths for DataTable (opt-in via `layoutStorageKey`). */

export type TableColumnLayout = {
  order: string[];
  widths: Record<string, number>;
};

export const TABLE_COLUMN_MIN_WIDTH = 64;
export const TABLE_COLUMN_MAX_WIDTH = 640;
export const TABLE_COLUMN_WIDTH_STEP = 16;
export const TABLE_COLUMN_WIDTH_STEP_LARGE = 48;

export function clampColumnWidth(
  width: number,
  minWidth: number = TABLE_COLUMN_MIN_WIDTH,
  maxWidth: number = TABLE_COLUMN_MAX_WIDTH,
): number {
  if (!Number.isFinite(width)) return minWidth;
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

export function readTableColumnLayout(storageKey: string): TableColumnLayout | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const order = Array.isArray((parsed as TableColumnLayout).order)
      ? (parsed as TableColumnLayout).order.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    const widthsRaw = (parsed as TableColumnLayout).widths;
    const widths: Record<string, number> = {};
    if (widthsRaw && typeof widthsRaw === "object") {
      for (const [id, value] of Object.entries(widthsRaw)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          widths[id] = clampColumnWidth(value);
        }
      }
    }
    return { order, widths };
  } catch {
    return null;
  }
}

export function writeTableColumnLayout(storageKey: string, layout: TableColumnLayout): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // Ignore quota / unavailable storage.
  }
}

export function clearTableColumnLayout(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore.
  }
}

/**
 * Merge stored order with the current column ids (default order).
 * Unknown/removed ids are dropped; new ids are inserted at their default-relative position.
 * `pinnedEndIds` (e.g. actions) are forced to the end in the given order.
 */
export function mergeColumnOrder(
  defaultOrder: readonly string[],
  storedOrder: readonly string[] | null | undefined,
  pinnedEndIds: readonly string[] = [],
): string[] {
  const defaultSet = new Set(defaultOrder);
  const pinnedSet = new Set(pinnedEndIds);
  const movableDefaults = defaultOrder.filter((id) => !pinnedSet.has(id));

  const known = (storedOrder ?? []).filter((id) => defaultSet.has(id) && !pinnedSet.has(id));
  const knownSet = new Set(known);
  const result = [...known];

  for (const id of movableDefaults) {
    if (knownSet.has(id)) continue;
    const defaultIndex = movableDefaults.indexOf(id);
    let insertAt = result.length;
    for (let i = defaultIndex - 1; i >= 0; i--) {
      const prev = movableDefaults[i]!;
      const idx = result.indexOf(prev);
      if (idx >= 0) {
        insertAt = idx + 1;
        break;
      }
    }
    if (insertAt === result.length) {
      for (let i = defaultIndex + 1; i < movableDefaults.length; i++) {
        const next = movableDefaults[i]!;
        const idx = result.indexOf(next);
        if (idx >= 0) {
          insertAt = idx;
          break;
        }
      }
    }
    result.splice(insertAt, 0, id);
  }

  for (const id of pinnedEndIds) {
    if (defaultSet.has(id)) result.push(id);
  }
  return result;
}

export function mergeColumnWidths(
  columnIds: readonly string[],
  defaults: ReadonlyMap<string, number>,
  stored: Record<string, number> | null | undefined,
  minWidths: ReadonlyMap<string, number> = new Map(),
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const id of columnIds) {
    const min = minWidths.get(id) ?? TABLE_COLUMN_MIN_WIDTH;
    const fallback = defaults.get(id) ?? min;
    const raw = stored?.[id];
    widths[id] = clampColumnWidth(typeof raw === "number" ? raw : fallback, min);
  }
  return widths;
}

/** Resolve a full layout for the currently available columns. */
export function resolveTableColumnLayout(args: {
  columnIds: readonly string[];
  defaultWidths: ReadonlyMap<string, number>;
  minWidths?: ReadonlyMap<string, number>;
  stored: TableColumnLayout | null;
  pinnedEndIds?: readonly string[];
}): { order: string[]; widths: Record<string, number> } {
  const order = mergeColumnOrder(args.columnIds, args.stored?.order, args.pinnedEndIds ?? []);
  const widths = mergeColumnWidths(order, args.defaultWidths, args.stored?.widths, args.minWidths);
  return { order, widths };
}

/**
 * Apply a new visible-column order onto the full stored order so hidden columns
 * keep their relative slots until they are shown again.
 */
export function applyVisibleColumnReorder(
  fullOrder: readonly string[],
  visibleOrder: readonly string[],
  pinnedEndIds: readonly string[] = [],
): string[] {
  const visibleSet = new Set(visibleOrder);
  const pinnedSet = new Set(pinnedEndIds);
  const result: string[] = [];
  let visibleIndex = 0;

  for (const id of fullOrder) {
    if (pinnedSet.has(id)) continue;
    if (visibleSet.has(id)) {
      const next = visibleOrder[visibleIndex++];
      if (next && !pinnedSet.has(next)) result.push(next);
    } else {
      result.push(id);
    }
  }
  while (visibleIndex < visibleOrder.length) {
    const next = visibleOrder[visibleIndex++]!;
    if (!pinnedSet.has(next) && !result.includes(next)) result.push(next);
  }
  for (const id of pinnedEndIds) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}
