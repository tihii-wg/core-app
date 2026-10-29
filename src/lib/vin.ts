import i18n from "../i18n";

/** ISO 3779 VIN alphabet: A–Z and 0–9 excluding I, O, and Q. */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Trim and uppercase; empty input stays empty. */
export function normalizeVin(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * Optional VIN: empty is valid; non-empty must be exactly 17 characters
 * from A–Z / 0–9 excluding I, O, and Q.
 */
export function isValidOptionalVin(value: string | null | undefined): boolean {
  const vin = normalizeVin(value);
  if (!vin) return true;
  return VIN_PATTERN.test(vin);
}

/**
 * Normalize and validate an optional VIN for persistence.
 * Returns null for empty input; throws with a localized message when invalid.
 */
export function assertValidOptionalVin(
  value: string | null | undefined,
  messageKey: "vehicles.validation.vinInvalid" | "orders.validation.vinLength" = "vehicles.validation.vinInvalid",
): string | null {
  const vin = normalizeVin(value);
  if (!vin) return null;
  if (!VIN_PATTERN.test(vin)) {
    throw new Error(i18n.t(messageKey));
  }
  return vin;
}

/** React Hook Form validate helper for optional VIN fields. */
export function optionalVinValidate(value: string | null | undefined, invalidMessage: string): true | string {
  return isValidOptionalVin(value) || invalidMessage;
}
