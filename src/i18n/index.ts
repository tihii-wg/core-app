import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { ro } from "./locales/ro";
import { ru } from "./locales/ru";
import { fallbackLanguage, intlLocales, isAppLanguage, languageFromPath, supportedLanguages, type AppLanguage } from "./languages";

export const resources = {
  en: { translation: en },
  ro: { translation: ro },
  ru: { translation: ru },
} as const;

// Resources are bundled, so init finishes synchronously and the first render is already translated.
// The URL language wins (see useUrlLanguage); reading it here avoids an English first paint on /ro and /ru.
void i18n.use(initReactI18next).init({
  resources,
  lng: typeof window === "undefined" ? fallbackLanguage : languageFromPath(window.location.pathname),
  fallbackLng: fallbackLanguage,
  supportedLngs: supportedLanguages,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
  react: { useSuspense: false },
});

export function currentLanguage(): AppLanguage {
  return isAppLanguage(i18n.language) ? i18n.language : fallbackLanguage;
}

/** Locale for Intl number, money and date-name formatting in the current UI language. */
export function currentIntlLocale() {
  return intlLocales[currentLanguage()];
}

export default i18n;
