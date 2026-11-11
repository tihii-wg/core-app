/** Cyrillic ↔ Latin look-alikes used on MD/RU plates. */
const PLATE_LOOKALIKES: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  У: "Y",
  A: "A",
  B: "B",
  E: "E",
  K: "K",
  M: "M",
  H: "H",
  O: "O",
  P: "P",
  C: "C",
  T: "T",
  X: "X",
  Y: "Y",
};

/** Normalize for plate/VIN matching: upper, keep only letters/digits, map look-alikes. */
export function normalizePlateVin(value: string): string {
  return Array.from(value.toUpperCase())
    .map((ch) => {
      // Separators people type in plates: spaces, dashes, dots, slashes, commas…
      if (!/[\p{L}\p{N}]/u.test(ch)) return "";
      return PLATE_LOOKALIKES[ch] ?? ch;
    })
    .join("");
}

/** True when `haystack` contains `needle` after plate normalization. */
export function plateMatchesQuery(haystack: string, needleRaw: string): boolean {
  const needle = normalizePlateVin(needleRaw);
  if (!needle) return true;
  return normalizePlateVin(haystack).includes(needle);
}

/**
 * PostgREST `ilike` pattern that tolerates separators between characters
 * (e.g. `B123ABC` matches stored `B 123 ABC` / `B-123-ABC`).
 * Caller must pass an already-normalized compact plate (no `%` / `_`).
 */
export function plateIlikeLoosePattern(compactNormalized: string): string {
  const safe = compactNormalized.replace(/[%_]/g, "");
  if (!safe) return "";
  return `%${safe.split("").join("%")}%`;
}

/**
 * Loose `ilike` patterns for a plate query, safe for PostgREST `or()`:
 * one with Cyrillic look-alikes mapped to Latin (matches plates stored in Latin) and one
 * keeping the typed letters (matches plates stored in Cyrillic). `term` must already be
 * sanitized with `searchTerm` (no `%_,().`).
 */
export function plateLoosePatterns(term: string): string[] {
  const mapped = normalizePlateVin(term).replace(/[^\p{L}\p{N}]/gu, "");
  const typed = term.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
  const out = new Set<string>();
  for (const compact of [mapped, typed]) {
    if (compact.length < 2) continue;
    const pattern = plateIlikeLoosePattern(compact);
    if (pattern) out.add(pattern);
  }
  return [...out];
}
