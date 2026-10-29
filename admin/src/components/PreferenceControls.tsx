import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/types";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "@/lib/cn";

export function PreferenceControls({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <label className="sr-only" htmlFor="admin-locale">
        {t("chrome.language")}
      </label>
      <select
        id="admin-locale"
        className="h-9 max-w-[9.5rem] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--fg)] shadow-xs transition hover:border-[color-mix(in_oklab,var(--border)_60%,var(--fg))] focus-visible:outline-none"
        value={locale}
        aria-label={t("chrome.language")}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en">{t("chrome.localeEn")}</option>
        <option value="ru">{t("chrome.localeRu")}</option>
      </select>

      <button
        type="button"
        className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] shadow-xs transition hover:bg-[color-mix(in_oklab,var(--bg)_70%,var(--border))] focus-visible:outline-none"
        aria-label={theme === "light" ? t("chrome.themeDark") : t("chrome.themeLight")}
        title={theme === "light" ? t("chrome.themeDark") : t("chrome.themeLight")}
        onClick={toggleTheme}
      >
        {theme === "light" ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
