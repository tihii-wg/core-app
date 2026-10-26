export const settingsTabs = ["general", "profile", "notifications", "security", "billing", "team", "appearance", "import"] as const;

export type SettingsTab = (typeof settingsTabs)[number];

/** Older bookmarks used `company`; treat it as General. */
export function settingsTabFromSearch(value: string | null): SettingsTab {
  if (value === "company") return "general";
  if (value && (settingsTabs as readonly string[]).includes(value)) return value as SettingsTab;
  return "general";
}

export function profileSettingsPath(locale: string, workspaceId: string) {
  return `/${locale}/${workspaceId}/settings?tab=profile`;
}

export function replaceLocale(pathname: string, locale: string, language: string) {
  const nextLanguage = language.trim();
  if (!nextLanguage || nextLanguage === locale) return pathname;
  if (pathname === `/${locale}`) return `/${nextLanguage}`;
  const prefix = `/${locale}/`;
  if (pathname.startsWith(prefix)) return `/${nextLanguage}/${pathname.slice(prefix.length)}`;
  return pathname;
}
