export type MinPaidPercentParse = { ok: true; value: number | null } | { ok: false };

/** Parses the «minimum paid, %» form field. Empty / 0 → null (no requirement); valid range is (0, 100]. */
export function parseMinPaidPercentInput(raw: string): MinPaidPercentParse {
  const text = raw.trim().replace(",", ".");
  if (!text) return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false };
  if (n === 0) return { ok: true, value: null };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Form-field text for a stored percent (null → empty). */
export function minPaidPercentToInput(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "" : String(value);
}
