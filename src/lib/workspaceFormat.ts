export const workspacePreferenceDefaults = {
  language: "en",
  timezone: "Europe/Chisinau",
  dateFormat: "DD.MM.YYYY",
  currency: "MDL",
} as const;

const currencySymbols: Record<string, string> = {
  MDL: "MDL",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
};

function applyDatePattern(day: string, month: string, year: string, pattern: string) {
  if (pattern === "MM/DD/YYYY") return `${month}/${day}/${year}`;
  if (pattern === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  if (pattern === "DD/MM/YYYY") return `${day}/${month}/${year}`;
  return `${day}.${month}.${year}`;
}

export function formatWorkspaceMoney(value: number | null, currency: string | null | undefined) {
  if (value == null) return "—";
  const code = currency?.trim() || workspacePreferenceDefaults.currency;
  const amount = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = currencySymbols[code];
  if (!symbol) return `${amount} ${code}`;
  if (symbol === code) return `${code} ${amount}`;
  return `${symbol}${amount}`;
}

export function formatWorkspaceDate(value: string, pattern: string | null | undefined, timeZone: string | null | undefined) {
  if (!value) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const format = pattern?.trim() || workspacePreferenceDefaults.dateFormat;
  if (dateOnly) return applyDatePattern(dateOnly[3], dateOnly[2], dateOnly[1], format);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const zone = timeZone?.trim() || workspacePreferenceDefaults.timezone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  }

  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  return applyDatePattern(day, month, year, format);
}
