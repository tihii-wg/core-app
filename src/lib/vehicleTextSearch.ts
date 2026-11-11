/**
 * Match vehicle make/model against a free-text query.
 * Every whitespace-separated token must appear in `make + model` (order-independent).
 * Does not mutate stored make/model values.
 */
export function vehicleMakeModelMatches(
  make: string | null | undefined,
  model: string | null | undefined,
  query: string,
): boolean {
  const haystack = `${make ?? ""} ${model ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
  if (!haystack) return false;
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.every((token) => haystack.includes(token));
}
