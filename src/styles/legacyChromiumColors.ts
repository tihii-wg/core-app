/**
 * Chrome ≤109 (last Chrome on Windows 7) does not support `oklch()` or `color-mix()`.
 * Tailwind v4 already emits `@supports (color-mix)` wrappers, but its non-supporting
 * fallback for CSS-variable colors is the *solid* token — so soft fills like
 * `bg-primary/10` become full-strength primary on legacy Chromium.
 *
 * These maps mirror `src/styles/globals.css` light/dark tokens so we can emit
 * translucent `rgba()` overrides inside `@supports not (color: color-mix(...))`.
 */

export const LIGHT_TOKEN_HEX: Record<string, string> = {
  "--background": "#f6f7f9",
  "--foreground": "#161a1f",
  "--card": "#ffffff",
  "--primary": "#1a6de0",
  "--secondary": "#eff1f4",
  "--muted": "#f1f3f5",
  "--accent": "#eef3fb",
  "--destructive": "#d92d20",
  "--success": "#12804f",
  "--warning": "#b45309",
  "--info": "#1a6de0",
  "--border": "#e3e6ea",
  "--border-strong": "#d0d5db",
  "--ring": "#1a6de0",
  "--chart-4": "#7a5af8",
  "--sidebar-foreground": "#3a414a",
};

export const DARK_TOKEN_HEX: Record<string, string> = {
  "--background": "#0e1014",
  "--foreground": "#e7e9ec",
  "--card": "#15181d",
  "--primary": "#3b82f6",
  "--secondary": "#22262d",
  "--muted": "#1d2127",
  "--accent": "#1b2738",
  "--destructive": "#f0544a",
  "--success": "#3cc68a",
  "--warning": "#f2a33a",
  "--info": "#5b9bff",
  "--border": "#262b32",
  "--border-strong": "#343a43",
  "--ring": "#5b9bff",
  "--chart-4": "#9b85ff",
  "--sidebar-foreground": "#b4bac3",
};

/** Classic Tailwind v3 hex stand-ins for palette colors that v4 emits as oklch(). */
export const PALETTE_HEX: Record<string, string> = {
  "--color-red-50": "#fef2f2",
  "--color-red-300": "#fca5a5",
  "--color-red-400": "#f87171",
  "--color-red-600": "#dc2626",
  "--color-amber-400": "#fbbf24",
  "--color-amber-500": "#f59e0b",
  "--color-amber-600": "#d97706",
  "--color-emerald-400": "#34d399",
  "--color-emerald-500": "#10b981",
  "--color-emerald-600": "#059669",
};

export function hexToRgba(hex: string, percent: number): string {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : raw;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const alpha = Math.round(percent * 10) / 1000; // percent 10 → 0.1
  const alphaStr = Number.isInteger(alpha) ? String(alpha) : String(alpha);
  return `rgba(${r}, ${g}, ${b}, ${alphaStr})`;
}

type ColorMixFallback = {
  selector: string;
  property: string;
  token: string;
  percent: number;
};

const COLOR_MIX_FALLBACK_RE =
  /\.((?:[a-z0-9_-]+\\:)*[a-z0-9_-]+(?:\\\/[0-9]+)?(?:\\\/\[[^\]]+\])?(?::[a-z0-9_-]+)*)\{(background-color|color|border-color|outline-color|--tw-ring-color):var\((--[a-z0-9-]+)\)\}@supports \(color:color-mix\(in lab, red, red\)\)\{\.\1\{\2:color-mix\(in oklab, var\(\3\) ([0-9.]+)%, transparent\)\}\}/g;

export function findColorMixFallbacks(css: string): ColorMixFallback[] {
  const found: ColorMixFallback[] = [];
  for (const match of css.matchAll(COLOR_MIX_FALLBACK_RE)) {
    found.push({
      selector: match[1],
      property: match[2],
      token: match[3],
      percent: Number(match[4]),
    });
  }
  return found;
}

function declaration(property: string, value: string): string {
  return `${property}:${value}`;
}

/**
 * Append `@supports not (color-mix)` overrides so Chrome ≤109 keeps soft fills
 * instead of Tailwind's solid-token fallbacks. Modern browsers ignore this block.
 */
export function appendLegacyColorMixFallbacks(css: string): string {
  const fallbacks = findColorMixFallbacks(css);
  if (fallbacks.length === 0) return css;

  const rules: string[] = [];
  const seen = new Set<string>();

  for (const item of fallbacks) {
    const light = LIGHT_TOKEN_HEX[item.token];
    const dark = DARK_TOKEN_HEX[item.token];
    if (!light || !dark) continue;

    const key = `${item.selector}|${item.property}|${item.percent}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const lightValue = hexToRgba(light, item.percent);
    const darkValue = hexToRgba(dark, item.percent);
    rules.push(`.${item.selector}{${declaration(item.property, lightValue)}}`);
    rules.push(`.dark .${item.selector}{${declaration(item.property, darkValue)}}`);
  }

  if (rules.length === 0) return css;

  return `${css}\n@supports not (color: color-mix(in lab, red, red)){\n${rules.join("")}\n}\n`;
}

/** Replace Tailwind v4 oklch palette custom properties with hex equivalents. */
export function replaceOklchPaletteVars(css: string): string {
  let next = css;
  for (const [name, hex] of Object.entries(PALETTE_HEX)) {
    next = next.replace(new RegExp(`${name}:oklch\\([^)]+\\)`, "g"), `${name}:${hex}`);
  }
  return next;
}

export function applyLegacyChromiumCssFixes(css: string): string {
  return appendLegacyColorMixFallbacks(replaceOklchPaletteVars(css));
}
