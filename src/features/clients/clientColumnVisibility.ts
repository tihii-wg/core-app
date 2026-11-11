export const CLIENT_TOGGLEABLE_COLUMNS = ["clientType", "contact", "orders", "balance", "created"] as const;

export type ClientToggleableColumn = (typeof CLIENT_TOGGLEABLE_COLUMNS)[number];

export const CLIENT_COLUMN_STORAGE_KEY = "coreapp.clients.visibleColumns";

/** Default: all toggleable Clients columns visible (`name` / `actions` are always shown). */
export const DEFAULT_CLIENT_VISIBLE_COLUMNS: ClientToggleableColumn[] = [...CLIENT_TOGGLEABLE_COLUMNS];

export function isClientToggleableColumn(value: unknown): value is ClientToggleableColumn {
  return typeof value === "string" && (CLIENT_TOGGLEABLE_COLUMNS as readonly string[]).includes(value);
}

export function readClientVisibleColumns(
  storageKey: string = CLIENT_COLUMN_STORAGE_KEY,
  defaults: readonly ClientToggleableColumn[] = DEFAULT_CLIENT_VISIBLE_COLUMNS,
): ClientToggleableColumn[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [...defaults];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...defaults];
    const valid = CLIENT_TOGGLEABLE_COLUMNS.filter((key) => parsed.includes(key));
    return valid.length > 0 ? valid : [...defaults];
  } catch {
    return [...defaults];
  }
}

export function writeClientVisibleColumns(
  columns: Iterable<ClientToggleableColumn>,
  storageKey: string = CLIENT_COLUMN_STORAGE_KEY,
) {
  const unique = CLIENT_TOGGLEABLE_COLUMNS.filter((key) => [...columns].includes(key));
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(unique));
  } catch {
    // Ignore quota / unavailable storage (e.g. private mode or test stubs).
  }
}
