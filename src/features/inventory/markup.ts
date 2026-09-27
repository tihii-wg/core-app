export function sellingPriceFromMarkup(purchasePrice: number | null, markupPercent: number) {
  if (purchasePrice == null || !Number.isFinite(purchasePrice) || !Number.isFinite(markupPercent)) return null;
  return Math.round(purchasePrice * (1 + markupPercent / 100) * 100) / 100;
}

export function parseMarkupPercent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const markup = Number(trimmed);
  if (!Number.isFinite(markup) || markup < 0) return null;
  return markup;
}
