import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en/settings";
import ro from "../../i18n/locales/ro/settings";
import ru from "../../i18n/locales/ru/settings";
import { TEMPLATE_ACTIONS_DESKTOP_CLASS } from "./PrintTemplatesSettings";

const here = dirname(fileURLToPath(import.meta.url));

const SOURCE_FILES = [
  "PrintTemplatesSettings.tsx",
  join("..", "documents", "DocumentStyleEditor.tsx"),
  join("..", "documents", "canvas", "CanvasDesigner.tsx"),
  join("..", "documents", "canvas", "CanvasPalette.tsx"),
  join("..", "documents", "canvas", "CanvasPropertiesPanel.tsx"),
] as const;

function collectPrintTemplateKeys(source: string): string[] {
  const keys = new Set<string>();
  const patterns = [
    /t\(\s*["'](settings\.printTemplates\.[^"']+)["']/g,
    /t\(\s*`(settings\.printTemplates\.[^`]+)`/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (!key || key.includes("${")) continue;
      keys.add(key);
    }
  }
  return [...keys].sort();
}

function lookup(locale: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = locale;
  // settings.ts default export is already the `settings` object contents for nested printTemplates,
  // but keys are full `settings.printTemplates…` — strip the leading `settings.` when walking this module.
  const walk = parts[0] === "settings" ? parts.slice(1) : parts;
  for (const part of walk) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

describe("print template i18n keys", () => {
  it("keeps template action rows wrappable (no shrink-0 with flex-wrap)", () => {
    expect(TEMPLATE_ACTIONS_DESKTOP_CLASS).toContain("flex-wrap");
    expect(TEMPLATE_ACTIONS_DESKTOP_CLASS).not.toContain("shrink-0");

    const source = readFileSync(join(here, "PrintTemplatesSettings.tsx"), "utf8");
    const bad = source.match(/className="[^"]*shrink-0[^"]*flex-wrap[^"]*"/g) ?? [];
    const badReverse = source.match(/className="[^"]*flex-wrap[^"]*shrink-0[^"]*"/g) ?? [];
    expect(bad).toEqual([]);
    expect(badReverse).toEqual([]);
  });

  it("defines every settings.printTemplates key used by the designer files in en/ro/ru", () => {
    const keys = new Set<string>();
    for (const relative of SOURCE_FILES) {
      const source = readFileSync(join(here, relative), "utf8");
      for (const key of collectPrintTemplateKeys(source)) keys.add(key);
    }

    expect(keys.size).toBeGreaterThan(10);
    expect(keys.has("settings.printTemplates.documentStyle")).toBe(true);

    const locales = { en, ro, ru } as const;
    for (const key of [...keys].sort()) {
      for (const [localeName, locale] of Object.entries(locales)) {
        const value = lookup(locale as unknown as Record<string, unknown>, key);
        expect(value, `${localeName} missing ${key}`).toEqual(expect.any(String));
        expect(String(value).length, `${localeName} empty ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
