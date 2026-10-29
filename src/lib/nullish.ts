/** Normalize optional form values for PostgREST / SQL NULL storage. */

export function nullIfEmptyText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function nullIfEmptyUuid(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Empty / whitespace → null. Explicit 0 stays 0. Invalid non-empty text throws via caller validation. */
export function nullIfEmptyNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function nullIfEmptyDate(value: string | null | undefined): string | null {
  const text = nullIfEmptyText(value);
  if (!text) return null;
  return text;
}
