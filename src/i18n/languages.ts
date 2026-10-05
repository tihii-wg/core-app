export const supportedLanguages = ["en", "ro", "ru"] as const;

export type AppLanguage = (typeof supportedLanguages)[number];

export const fallbackLanguage: AppLanguage = "en";

/** Each language in its own name, as shown in the language picker. */
export const languageNames: Record<AppLanguage, string> = {
  en: "English",
  ro: "Română",
  ru: "Русский",
};

/** BCP 47 locale used by Intl for numbers, money and month/day names. */
export const intlLocales: Record<AppLanguage, string> = {
  en: "en-US",
  ro: "ro-RO",
  ru: "ru-RU",
};

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return (supportedLanguages as readonly string[]).includes(value ?? "");
}

/** The language in the first URL segment (/en/..., /ro/..., /ru/...); anything else falls back to English. */
export function languageFromPath(pathname: string): AppLanguage {
  const segment = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return isAppLanguage(segment) ? segment : fallbackLanguage;
}
