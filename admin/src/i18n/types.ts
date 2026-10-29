export type Locale = "en" | "ru";

export const LOCALES: readonly Locale[] = ["en", "ru"] as const;

export const LOCALE_STORAGE_KEY = "core-app-admin-locale";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ru";
}
