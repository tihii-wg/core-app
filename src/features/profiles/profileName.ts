import i18n from "../../i18n";

export function profileDisplayName(fullName: string | null | undefined, fallback?: string | null) {
  return fullName?.trim() || fallback?.trim() || i18n.t("settings.profile.defaultName");
}

export function profileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}
