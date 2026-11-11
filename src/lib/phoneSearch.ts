/** Minimum digit length for phone-oriented search variants (avoids 1–2 digit noise). */
export const MIN_PHONE_SEARCH_DIGITS = 3;

/** Strip everything except digits. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Build digit variants so local MD (`069…`) and international (`+37369…`) forms
 * can match the same stored phone without rewriting DB values.
 */
export function phoneSearchVariants(rawDigits: string): string[] {
  const d = phoneDigits(rawDigits);
  if (d.length < MIN_PHONE_SEARCH_DIGITS) return [];

  const out = new Set<string>([d]);

  // Local leading 0 → country 373 + national, and national without 0.
  if (d.startsWith("0") && d.length >= 8) {
    out.add(`373${d.slice(1)}`);
    out.add(d.slice(1));
  }

  // +373 / 373 national forms → local 0… and bare national.
  if (d.startsWith("373") && d.length >= 11) {
    const national = d.slice(3);
    if (national.length >= MIN_PHONE_SEARCH_DIGITS) {
      out.add(national);
      out.add(`0${national}`);
    }
  }

  return [...out].filter((variant) => variant.length >= MIN_PHONE_SEARCH_DIGITS);
}

/** True when stored phone matches the query after digit normalization / MD variants. */
export function phoneMatchesQuery(storedPhone: string, query: string): boolean {
  const needleDigits = phoneDigits(query);
  if (needleDigits.length < MIN_PHONE_SEARCH_DIGITS) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return storedPhone.toLowerCase().includes(q);
  }
  const hay = phoneDigits(storedPhone);
  if (!hay) return false;
  return phoneSearchVariants(needleDigits).some((variant) => hay.includes(variant));
}
