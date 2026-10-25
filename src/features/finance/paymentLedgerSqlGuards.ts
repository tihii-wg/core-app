/**
 * Mirrors the CHECK-definition allowlists used by
 * `supabase/manual-sql/harden_payment_ledger.sql`. Exact normalized forms only
 * (fail-closed). TypeScript tests do not prove PostgreSQL syntax.
 */

/** Must match COMMENT ON FUNCTION in harden_payment_ledger.sql (exact string). */
export const PAYMENTS_ENFORCE_INTEGRITY_MANAGED_MARKER =
  "managed-object: core-app/payments_enforce_integrity@v1";

/** Strip whitespace and common `pg_get_constraintdef` casts. Optionally lower-case. */
export function normalizePgCheckDef(def: string, options?: { lower?: boolean }): string {
  let out = def.replace(/\s+/g, "");
  if (options?.lower !== false) out = out.toLowerCase();
  // Strip array casts before scalar ::text so `::text[]` does not become `[]`.
  out = out.replace(/::text\[\]/gi, "");
  out = out.replace(/::text\b/gi, "");
  out = out.replace(/::numeric\b/gi, "");
  out = out.replace(/::bpchar\b/gi, "");
  out = out.replace(/::charactervarying\b/gi, "");
  return out;
}

function permutations(values: string[]): string[][] {
  if (values.length <= 1) return [values.slice()];
  const out: string[][] = [];
  for (let i = 0; i < values.length; i++) {
    const rest = values.slice(0, i).concat(values.slice(i + 1));
    for (const perm of permutations(rest)) out.push([values[i], ...perm]);
  }
  return out;
}

/** Exact normalized allowlist for kind ∈ {payment, refund} — mirrors SQL. */
export function kindCheckAllowlist(): Set<string> {
  const set = new Set<string>();
  for (const perm of permutations(["payment", "refund"])) {
    const q = perm.map((v) => `'${v}'`).join(",");
    set.add(`check((kind=any(array[${q}])))`);
    set.add(`check((kind=any('{${perm.join(",")}}')))`);
    set.add(`check((kindin(${q})))`);
  }
  return set;
}

/** Exact normalized allowlist for payment_method four-value set — mirrors SQL. */
export function paymentMethodCheckAllowlist(): Set<string> {
  const set = new Set<string>();
  for (const perm of permutations(["cash", "card", "bank_transfer", "other"])) {
    const q = perm.map((v) => `'${v}'`).join(",");
    set.add(`check((payment_method=any(array[${q}])))`);
    set.add(`check((payment_method=any('{${perm.join(",")}}')))`);
    set.add(`check((payment_methodin(${q})))`);
  }
  return set;
}

/** Intended rule: CHECK (amount > 0) */
export function isAcceptedPaymentsAmountCheck(def: string): boolean {
  const n = normalizePgCheckDef(def);
  return n === "check((amount>0))" || n === "check((amount>(0)))" || n === "check(amount>0)";
}

/** Intended rule: kind ∈ {payment, refund} via exact allowlist. */
export function isAcceptedPaymentsKindCheck(def: string): boolean {
  return kindCheckAllowlist().has(normalizePgCheckDef(def));
}

/** Intended rule: payment_method ∈ {cash, card, bank_transfer, other} via exact allowlist. */
export function isAcceptedPaymentsPaymentMethodCheck(def: string): boolean {
  return paymentMethodCheckAllowlist().has(normalizePgCheckDef(def));
}

/**
 * Intended rule: currency_code ~ '^[A-Z]{3}$'
 * Case-preserving (regex must remain uppercase A-Z).
 */
export function isAcceptedPaymentsCurrencyCodeFormatCheck(def: string): boolean {
  const n = normalizePgCheckDef(def, { lower: false });
  return (
    n === "CHECK((currency_code~'^[A-Z]{3}$'))" ||
    n === "CHECK(currency_code~'^[A-Z]{3}$')" ||
    n === "check((currency_code~'^[A-Z]{3}$'))" ||
    n === "check(currency_code~'^[A-Z]{3}$')"
  );
}
