import type { TFunction } from "i18next";

/** Whole-unit odometer / warranty-km ceiling (inclusive). */
export const MAX_MILEAGE = 9_999_999;

const MILEAGE_WHITESPACE_AND_APOSTROPHES = /[\s\u00A0\u202F\u2009'’]/g;
const THOUSANDS_GROUPED = /^\d{1,3}([.,]\d{3})+$/;

export type MileageI18nKey =
  | "vehicles.validation.mileageInvalid"
  | "vehicles.validation.mileageTooLarge";

export class MileageParseError extends Error {
  readonly i18nKey: MileageI18nKey;

  constructor(i18nKey: MileageI18nKey) {
    super(i18nKey);
    this.name = "MileageParseError";
    this.i18nKey = i18nKey;
  }
}

function throwInvalid(): never {
  throw new MileageParseError("vehicles.validation.mileageInvalid");
}

function throwTooLarge(): never {
  throw new MileageParseError("vehicles.validation.mileageTooLarge");
}

function assertMileageRange(n: number): number {
  if (!Number.isInteger(n) || n < 0) throwInvalid();
  if (n > MAX_MILEAGE) throwTooLarge();
  return n;
}

/**
 * Parse a mileage form value into a whole non-negative integer (0…9_999_999).
 * Empty / whitespace-only → null. Invalid → MileageParseError with an i18n key.
 *
 * Accepts thousands separators (spaces, NBSP, thin/narrow spaces, apostrophes, and
 * `.` / `,` only when they form valid thousands groups). Decimals are rejected.
 */
export function parseMileageInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throwInvalid();
    if (raw !== Math.trunc(raw)) throwInvalid();
    return assertMileageRange(raw);
  }

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip grouping whitespace / apostrophes first; keep `.` and `,` for thousands checks.
  const withoutGroupingMarks = trimmed.replace(MILEAGE_WHITESPACE_AND_APOSTROPHES, "");
  if (!withoutGroupingMarks) return null;

  let digits: string;
  if (/[.,]/.test(withoutGroupingMarks)) {
    if (!THOUSANDS_GROUPED.test(withoutGroupingMarks)) throwInvalid();
    digits = withoutGroupingMarks.replace(/[.,]/g, "");
  } else {
    digits = withoutGroupingMarks;
  }

  if (!/^\d+$/.test(digits)) throwInvalid();
  // Leading zeros are fine ("000" → 0); reject only if the numeric value overflows.
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) throwTooLarge();
  return assertMileageRange(n);
}

/**
 * Format a mileage integer for inputs / display with locale grouping.
 * ru/ro always use a regular space (not NBSP / not `.`) so editing and copying stay easy.
 */
export function formatMileageInput(value: number | null, locale: string): string {
  if (value == null || !Number.isFinite(value)) return "";
  const normalized = (locale || "en").toLowerCase();
  if (normalized.startsWith("ru") || normalized.startsWith("ro")) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
      .format(Math.trunc(value))
      .replace(/,/g, " ");
  }
  return new Intl.NumberFormat(locale || "en", { maximumFractionDigits: 0 })
    .format(Math.trunc(value))
    .replace(/[\u00A0\u202F]/g, " ");
}

/** react-hook-form validator: empty allowed unless `required`. */
export function mileageValidate(
  value: string | null | undefined,
  t: TFunction,
  options?: { required?: boolean },
): true | string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return options?.required ? t("vehicles.validation.mileageInvalid") : true;
  }
  try {
    parseMileageInput(value);
    return true;
  } catch (error) {
    if (error instanceof MileageParseError) return t(error.i18nKey);
    return t("vehicles.validation.mileageInvalid");
  }
}

/**
 * Defensive guard before writing mileage to the API/DB.
 * Null stays null; non-integers / out-of-range throw MileageParseError.
 */
export function assertStoredMileage(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) throwInvalid();
  const truncated = Math.trunc(value);
  if (truncated !== value || !Number.isInteger(truncated)) throwInvalid();
  return assertMileageRange(truncated);
}
