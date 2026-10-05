import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import i18n from ".";
import { languageFromPath } from "./languages";

/**
 * Keeps i18next on the language in the URL. The URL is the only language state: Settings saves
 * the workspace language and rewrites the first path segment, and AppLayout redirects to the
 * workspace language, so the UI follows either change without a reload.
 */
export function useUrlLanguage() {
  const { pathname } = useLocation();
  const language = languageFromPath(pathname);

  useLayoutEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);
}
