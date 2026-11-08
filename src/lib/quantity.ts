/**
 * Shared order / inventory quantity helpers (numeric with at most 2 decimals).
 * Matches DB checks: quantity > 0 and at most 2 decimal places.
 */

import { isAppLanguage, intlLocales, type AppLanguage } from "../i18n/languages";

export const QUANTITY_DECIMALS = 2;

export type ParseQuantityError = "required" | "min" | "maxDecimals";

const FACTOR = 10 ** QUANTITY_DECIMALS;

/** Round half-away-from-zero to 2 decimals without binary float surprises. */
export function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const shifted = Number(`${abs}e${QUANTITY_DECIMALS}`);
  const rounded = Number.isFinite(shifted) ? Math.round(shifted) : Math.round(abs * FACTOR);
  const result = (sign * rounded) / FACTOR;
  return result === 0 ? 0 : result;
}

function normalizeQuantityInput(input: unknown): string | null {
  if (input === "" || input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return String(input);
  }
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!trimmed) return null;
  return trimmed.replace(",", ".");
}

function decimalPlacesOf(normalized: string): number {
  const dot = normalized.indexOf(".");
  if (dot < 0) return 0;
  // Ignore trailing zeros in the typed form so "2.50" is still 2 decimals max, not rejected.
  const frac = normalized.slice(dot + 1).replace(/0+$/, "");
  return frac.length;
}

/**
 * Parse a user-typed quantity. Accepts "2,5" and "2.5".
 * Returns a number rounded to 2 decimals, or an error key.
 */
export function parseQuantity(input: unknown): number | ParseQuantityError {
  const normalized = normalizeQuantityInput(input);
  if (normalized == null) return "required";

  // Reject scientific notation and other non-decimal forms.
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return "required";

  if (decimalPlacesOf(normalized) > QUANTITY_DECIMALS) return "maxDecimals";

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return "required";

  const value = roundQuantity(parsed);
  if (!(value > 0)) return "min";
  return value;
}

/** True when `value` is a finite quantity with at most 2 decimals and > 0. */
export function isValidQuantity(value: unknown): value is number {
  return typeof parseQuantity(value) === "number";
}

function resolveAppLanguage(locale?: string | null): AppLanguage {
  const raw = (locale ?? "").trim().toLowerCase();
  if (isAppLanguage(raw)) return raw;
  const short = raw.slice(0, 2);
  if (isAppLanguage(short)) return short;
  return "en";
}

/**
 * Display quantity without trailing zeros.
 * ru/ro → comma decimal ("2,5"); en → dot ("2.5"). Whole numbers stay without a fraction ("2").
 */
export function formatQuantity(n: number, locale?: string | null): string {
  if (!Number.isFinite(n)) return "";
  const rounded = roundQuantity(n);
  const language = resolveAppLanguage(locale);
  const intlLocale = intlLocales[language];
  return rounded.toLocaleString(intlLocale, {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: QUANTITY_DECIMALS,
  });
}
