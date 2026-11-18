/**
 * Puts the currency code before ("MDL 1 200,00") or after ("1 200,00 MDL") a formatted amount in printed
 * documents, per the workspace setting `print_currency_position` (default: before).
 */
export function withPrintCurrency(
  amount: string,
  currency: string | null | undefined,
  ctx: { workspace?: { printCurrencyPosition?: "before" | "after" | null } | null } | null | undefined,
): string {
  const code = currency?.trim() ?? "";
  if (!code) return amount;
  return ctx?.workspace?.printCurrencyPosition === "after" ? `${amount} ${code}` : `${code} ${amount}`;
}
