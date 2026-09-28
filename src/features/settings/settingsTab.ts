export const settingsTabs = ["company", "profile", "notifications", "security", "billing", "team", "appearance"] as const;

export type SettingsTab = (typeof settingsTabs)[number];

export function settingsTabFromSearch(value: string | null): SettingsTab {
  if (value && (settingsTabs as readonly string[]).includes(value)) return value as SettingsTab;
  return "company";
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
