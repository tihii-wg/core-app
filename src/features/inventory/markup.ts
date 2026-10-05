import i18n from "../../i18n";

/** Whole-number percent. 25 means 25%. Values above 1000 are rejected. */
export const MAX_MARKUP_PERCENT = 1000;

export function sellingPriceFromMarkup(purchasePrice: number | null, markupPercent: number) {
  if (purchasePrice == null || !Number.isFinite(purchasePrice) || !Number.isFinite(markupPercent)) return null;
  return Math.round(purchasePrice * (1 + markupPercent / 100) * 100) / 100;
}

export function markupFieldError(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return i18n.t("inventory.markup.required");

  const markup = Number(trimmed);
  if (!Number.isFinite(markup)) return i18n.t("inventory.markup.notNumber");
  if (markup < 0) return i18n.t("inventory.markup.negative");
  if (markup > MAX_MARKUP_PERCENT) return i18n.t("inventory.markup.tooHigh", { max: MAX_MARKUP_PERCENT });
  return null;
}

export function parseMarkupPercent(value: string) {
  if (markupFieldError(value)) return null;
  return Number(value.trim());
}
