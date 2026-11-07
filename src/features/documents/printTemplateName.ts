import type { TFunction } from "i18next";
import i18n from "../../i18n";

const PRINT_TEMPLATE_KEY_PREFIX = "settings.printTemplates.";

/** True when `name` looks like a print-templates i18n key that exists in the current catalog. */
export function isPrintTemplateI18nKey(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed.startsWith(PRINT_TEMPLATE_KEY_PREFIX)) return false;
  return i18n.exists(trimmed);
}

/**
 * Display name for a template row. Stored names that are unresolved i18n keys
 * (e.g. style row created before translations loaded) are translated for the UI.
 */
export function displayPrintTemplateName(name: string, t: TFunction): string {
  if (isPrintTemplateI18nKey(name)) {
    return String(t(name as "settings.printTemplates.documentStyle"));
  }
  return name;
}

export const DOCUMENT_STYLE_NAME_KEY = "settings.printTemplates.documentStyle" as const;

/** Resolved document-style display name for inserts / migrations. */
export function translatedDocumentStyleName(t: TFunction = i18n.t.bind(i18n)): string {
  const translated = String(t(DOCUMENT_STYLE_NAME_KEY));
  if (translated === DOCUMENT_STYLE_NAME_KEY || !translated.trim()) {
    return "Document style";
  }
  return translated;
}
