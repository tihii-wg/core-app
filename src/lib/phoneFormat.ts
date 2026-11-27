/**
 * International phone numbers (E.164): "+", country code, number — 7 to 15 digits in total.
 * Any country is accepted, e.g. +37369123456, +40721234567, +380501234567, +4915123456789.
 */
export const INTERNATIONAL_PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Cleans what a person typed or pasted before it is validated and saved:
 * spaces, dashes, dots and brackets are dropped and a leading "00" becomes "+",
 * so "+49 (151) 234-56-78" and "0040 721 234 567" are stored as plain +digits.
 */
export function normalizePhoneInput(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/[\s\-.()]/g, "");
  return compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
}
