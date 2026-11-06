/** Integer + fractional (bani/копейки/cents) amount-in-words for print templates. */

export type AmountInWordsLocale = "en" | "ro" | "ru";

function splitMoney(amount: number): { whole: number; fraction: number } {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const cents = Math.round(safe * 100);
  return { whole: Math.floor(cents / 100), fraction: cents % 100 };
}

const EN_ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function enUnder1000(n: number): string {
  if (n === 0) return "";
  if (n < 20) return EN_ONES[n] ?? "";
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return one ? `${EN_TENS[ten]}-${EN_ONES[one]}` : (EN_TENS[ten] ?? "");
  }
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${EN_ONES[hundred]} hundred ${enUnder1000(rest)}` : `${EN_ONES[hundred]} hundred`;
}

function enInteger(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const rest = n % 1_000;
  if (millions) parts.push(`${enUnder1000(millions)} million`);
  if (thousands) parts.push(`${enUnder1000(thousands)} thousand`);
  if (rest) parts.push(enUnder1000(rest));
  return parts.join(" ");
}

const RO_ONES = [
  "",
  "unu",
  "doi",
  "trei",
  "patru",
  "cinci",
  "șase",
  "șapte",
  "opt",
  "nouă",
  "zece",
  "unsprezece",
  "doisprezece",
  "treisprezece",
  "paisprezece",
  "cincisprezece",
  "șaisprezece",
  "șaptesprezece",
  "optsprezece",
  "nouăsprezece",
];
const RO_TENS = ["", "", "douăzeci", "treizeci", "patruzeci", "cincizeci", "șaizeci", "șaptezeci", "optzeci", "nouăzeci"];

function roUnder1000(n: number, feminine = false): string {
  if (n === 0) return "";
  if (n === 1 && feminine) return "o";
  if (n === 2 && feminine) return "două";
  if (n < 20) return RO_ONES[n] ?? "";
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return one ? `${RO_TENS[ten]} și ${roUnder1000(one, feminine)}` : (RO_TENS[ten] ?? "");
  }
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const hundredWord =
    hundred === 1 ? "o sută" : hundred === 2 ? "două sute" : `${RO_ONES[hundred]} sute`;
  return rest ? `${hundredWord} ${roUnder1000(rest, feminine)}` : hundredWord;
}

function roInteger(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const rest = n % 1_000;
  if (millions === 1) parts.push("un milion");
  else if (millions > 1) parts.push(`${roUnder1000(millions)} milioane`);
  if (thousands === 1) parts.push("o mie");
  else if (thousands > 1) parts.push(`${roUnder1000(thousands, true)} mii`);
  if (rest) parts.push(roUnder1000(rest));
  return parts.join(" ");
}

const RU_ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
];
const RU_TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const RU_HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function ruUnder1000(n: number, feminine = false): string {
  if (n === 0) return "";
  const ones = feminine ? RU_ONES_F : RU_ONES_M;
  const parts: string[] = [];
  const hundred = Math.floor(n / 100);
  const rem = n % 100;
  if (hundred) parts.push(RU_HUNDREDS[hundred] ?? "");
  if (rem >= 10 && rem < 20) {
    parts.push(RU_TEENS[rem - 10] ?? "");
  } else {
    const ten = Math.floor(rem / 10);
    const one = rem % 10;
    if (ten) parts.push(RU_TENS[ten] ?? "");
    if (one) parts.push(ones[one] ?? "");
  }
  return parts.filter(Boolean).join(" ");
}

function ruPlural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function ruInteger(n: number): string {
  if (n === 0) return "ноль";
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const rest = n % 1_000;
  if (millions) {
    parts.push(ruUnder1000(millions));
    parts.push(ruPlural(millions, "миллион", "миллиона", "миллионов"));
  }
  if (thousands) {
    parts.push(ruUnder1000(thousands, true));
    parts.push(ruPlural(thousands, "тысяча", "тысячи", "тысяч"));
  }
  if (rest) parts.push(ruUnder1000(rest));
  return parts.filter(Boolean).join(" ");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Converts a money amount to words for the given UI/document language. */
export function amountInWords(amount: number, locale: AmountInWordsLocale): string {
  const { whole, fraction } = splitMoney(amount);
  if (locale === "ru") {
    const wholeWords = ruInteger(whole);
    const bani = ruPlural(fraction, "бань", "баня", "баней");
    // Prefer common print form: «двадцать один лей 05 баней»
    return `${wholeWords} ${ruPlural(whole, "лей", "лея", "леев")} ${pad2(fraction)} ${bani}`;
  }
  if (locale === "ro") {
    const wholeWords = roInteger(whole);
    const lei = whole === 1 ? "leu" : "lei";
    const bani = fraction === 1 ? "ban" : "bani";
    return `${wholeWords} ${lei} ${pad2(fraction)} ${bani}`;
  }
  const wholeWords = enInteger(whole);
  const unit = whole === 1 ? "leu" : "lei";
  const minor = fraction === 1 ? "ban" : "bani";
  return `${wholeWords} ${unit} and ${pad2(fraction)} ${minor}`;
}

export function normalizeAmountInWordsLocale(locale: string | null | undefined): AmountInWordsLocale {
  const code = (locale ?? "en").trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (code === "ru") return "ru";
  if (code === "ro") return "ro";
  return "en";
}
