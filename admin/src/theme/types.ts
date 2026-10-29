export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "core-app-admin-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}
