export const EMPLOYEE_TOGGLEABLE_COLUMNS = ["status", "role", "open", "overdue", "closed"] as const;

export type EmployeeToggleableColumn = (typeof EMPLOYEE_TOGGLEABLE_COLUMNS)[number];

export const EMPLOYEE_COLUMN_STORAGE_KEY = "coreapp.employees.visibleColumns";

/** Default: all toggleable Employees columns visible (`name` / `actions` are always shown). */
export const DEFAULT_EMPLOYEE_VISIBLE_COLUMNS: EmployeeToggleableColumn[] = [...EMPLOYEE_TOGGLEABLE_COLUMNS];

export function isEmployeeToggleableColumn(value: unknown): value is EmployeeToggleableColumn {
  return typeof value === "string" && (EMPLOYEE_TOGGLEABLE_COLUMNS as readonly string[]).includes(value);
}

export function readEmployeeVisibleColumns(
  storageKey: string = EMPLOYEE_COLUMN_STORAGE_KEY,
  defaults: readonly EmployeeToggleableColumn[] = DEFAULT_EMPLOYEE_VISIBLE_COLUMNS,
): EmployeeToggleableColumn[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [...defaults];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...defaults];
    const valid = EMPLOYEE_TOGGLEABLE_COLUMNS.filter((key) => parsed.includes(key));
    return valid.length > 0 ? valid : [...defaults];
  } catch {
    return [...defaults];
  }
}

export function writeEmployeeVisibleColumns(
  columns: Iterable<EmployeeToggleableColumn>,
  storageKey: string = EMPLOYEE_COLUMN_STORAGE_KEY,
) {
  const unique = EMPLOYEE_TOGGLEABLE_COLUMNS.filter((key) => [...columns].includes(key));
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(unique));
  } catch {
    // Ignore quota / unavailable storage (e.g. private mode or test stubs).
  }
}
