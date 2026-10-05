import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { ro } from "./locales/ro";
import { ru } from "./locales/ru";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...flat, [path]: value } : { ...flat, ...flatten(value, path) };
  }, {});
}

const pluralForms = {
  ro: ["one", "few", "other"],
  ru: ["one", "few", "many", "other"],
};

const english = flatten(en as Tree);
const pluralBases = [...new Set(Object.keys(english).filter((key) => /_(one|other)$/.test(key)).map((key) => key.replace(/_(one|other)$/, "")))];

describe.each([
  ["ro", flatten(ro as Tree)],
  ["ru", flatten(ru as Tree)],
] as const)("%s messages", (language, messages) => {
  it("has every English key with a non-empty value", () => {
    const singular = Object.keys(english).filter((key) => !/_(one|other)$/.test(key));
    expect(singular.filter((key) => !messages[key]?.trim())).toEqual([]);
  });

  it("has every plural form the language needs", () => {
    const missing = pluralBases.flatMap((base) => pluralForms[language].map((form) => `${base}_${form}`)).filter((key) => !messages[key]?.trim());
    expect(missing).toEqual([]);
  });

  it("keeps the same interpolation variables as English", () => {
    const variables = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();
    const mismatched = Object.keys(english)
      .filter((key) => !/_(one|other)$/.test(key) && messages[key])
      .filter((key) => variables(english[key]).join() !== variables(messages[key]).join());
    expect(mismatched).toEqual([]);
  });
});
