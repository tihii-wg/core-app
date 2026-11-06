/** Color references: hex or theme:* keys resolved against a style palette. */

import { isSafeHexColor } from "./layoutHex";

export { isSafeHexColor };

export type ThemeColorKey = "primary" | "primaryDark" | "tint" | "muted" | "text" | "border";

export type ColorRef = string;

export type StyleColorPalette = Record<ThemeColorKey, string>;

const THEME_PREFIX = "theme:";
const THEME_KEYS = new Set<ThemeColorKey>(["primary", "primaryDark", "tint", "muted", "text", "border"]);

export function isThemeColorRef(value: string): value is `theme:${ThemeColorKey}` {
  if (!value.startsWith(THEME_PREFIX)) return false;
  return THEME_KEYS.has(value.slice(THEME_PREFIX.length) as ThemeColorKey);
}

export function isColorRef(value: string): boolean {
  const trimmed = value.trim();
  return isSafeHexColor(trimmed) || isThemeColorRef(trimmed);
}

export function themeRef(key: ThemeColorKey): ColorRef {
  return `${THEME_PREFIX}${key}`;
}

/** Resolves ColorRef against a palette; returns a safe hex or undefined. */
export function resolveColorRef(ref: ColorRef | undefined, colors: StyleColorPalette): string | undefined {
  if (!ref) return undefined;
  const trimmed = ref.trim();
  if (isSafeHexColor(trimmed)) return trimmed;
  if (isThemeColorRef(trimmed)) {
    const key = trimmed.slice(THEME_PREFIX.length) as ThemeColorKey;
    const resolved = colors[key];
    return typeof resolved === "string" && isSafeHexColor(resolved) ? resolved.trim() : undefined;
  }
  return undefined;
}
