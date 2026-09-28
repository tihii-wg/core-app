/** Whole-number percent. 25 means 25%. Values above 1000 are rejected. */
export const MAX_MARKUP_PERCENT = 1000;

export function sellingPriceFromMarkup(purchasePrice: number | null, markupPercent: number) {
  if (purchasePrice == null || !Number.isFinite(purchasePrice) || !Number.isFinite(markupPercent)) return null;
  return Math.round(purchasePrice * (1 + markupPercent / 100) * 100) / 100;
}

export function markupFieldError(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Markup percentage is required";

  const markup = Number(trimmed);
  if (!Number.isFinite(markup)) return "Markup percentage must be a number";
  if (markup < 0) return "Markup percentage cannot be negative";
  if (markup > MAX_MARKUP_PERCENT) return "Markup percentage cannot be greater than 1000";
  return null;
}

export function parseMarkupPercent(value: string) {
  if (markupFieldError(value)) return null;
  return Number(value.trim());
}
