import en, { type Messages } from "./messages/en";
import ru from "./messages/ru";
import type { Locale } from "./types";

const catalogs: Record<Locale, Messages> = { en, ru };

type Primitive = string | number | boolean | null | undefined;

type PathImpl<T, Key extends keyof T> = Key extends string
  ? T[Key] extends Primitive
    ? Key
    : T[Key] extends Record<string, unknown>
      ? `${Key}.${PathImpl<T[Key], keyof T[Key]>}`
      : never
  : never;

export type MessageKey = PathImpl<Messages, keyof Messages>;

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as object)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

export function translate(
  locale: Locale,
  key: MessageKey | string,
  vars?: Record<string, string | number>,
): string {
  const primary = getByPath(catalogs[locale], key);
  const fallback = getByPath(catalogs.en, key);
  let text =
    typeof primary === "string"
      ? primary
      : typeof fallback === "string"
        ? fallback
        : key;

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
  }
  return text;
}

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
