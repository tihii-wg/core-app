/**
 * Old browsers (e.g. Chrome ≤ 110 on Windows 7) do not support `color-mix()`. Tailwind v4 compiles
 * translucent utilities such as `bg-destructive/[0.035]` or `bg-muted/40` to
 *   background-color: var(--destructive);                       ← fallback: the FULL colour
 *   @supports (color: color-mix(...)) { background-color: color-mix(in oklab, var(--destructive) 3.5%, transparent) }
 * so those browsers paint e.g. every out-of-stock row solid red.
 *
 * Only where color-mix is unsupported, this finds those utility rules (class names with an alpha:
 * `/40`, `/[0.035]`, `/[12%]`) and adds an override with the same selector and the real translucent colour
 * (rgba computed from the current theme's CSS variables). Recomputed when the theme (html class / style)
 * changes and when new stylesheets are added. Modern browsers: does nothing.
 */

const COLOR_PROPS = [
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
  "--tw-ring-color",
  "--tw-shadow-color",
  "--tw-gradient-from",
  "--tw-gradient-via",
  "--tw-gradient-to",
] as const;

const STYLE_ID = "crm-color-mix-fallback";

function supportsColorMix(): boolean {
  try {
    return typeof CSS !== "undefined" && CSS.supports("color", "color-mix(in lab, red, red)");
  } catch {
    return false;
  }
}

/** `bg-muted\/40` → 0.4, `bg-x\/\[0\.035\]` → 0.035, `bg-x\/\[12%\]` → 0.12. */
function alphaFromSelector(selector: string): number | null {
  const unescaped = selector.replace(/\\/g, "");
  const bracket = /\/\[([\d.]+)(%?)\]/.exec(unescaped);
  if (bracket) {
    const value = Number(bracket[1]);
    if (!Number.isFinite(value)) return null;
    return bracket[2] === "%" ? value / 100 : value <= 1 ? value : value / 100;
  }
  const plain = /\/(\d{1,3})(?![\d\]])/.exec(unescaped);
  if (plain) {
    const value = Number(plain[1]);
    return Number.isFinite(value) && value <= 100 ? value / 100 : null;
  }
  return null;
}

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour the browser understands → [r, g, b, a] (null when it cannot parse it). */
function parseColor(value: string): [number, number, number, number] | null {
  if (!probe) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    probe = canvas.getContext("2d");
  }
  if (!probe) return null;
  probe.fillStyle = "#010203";
  probe.fillStyle = value;
  const normalized = String(probe.fillStyle);
  if (normalized === "#010203" && !/^#010203$/i.test(value.trim())) return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(normalized);
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => Number(part.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

function resolveValue(raw: string, rootStyle: CSSStyleDeclaration): string | null {
  let value = raw.trim();
  for (let depth = 0; depth < 6; depth++) {
    const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value);
    if (!match) break;
    const next = rootStyle.getPropertyValue(match[1]).trim() || (match[2] ?? "").trim();
    if (!next) return null;
    value = next;
  }
  return value || null;
}

function collectRules(list: CSSRuleList, out: CSSStyleRule[]) {
  for (let index = 0; index < list.length; index++) {
    const rule = list[index];
    if (rule instanceof CSSStyleRule) {
      if (rule.selectorText.includes("\\/")) out.push(rule);
    } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
      // @media / @layer: keep the media condition by re-emitting inside the same at-rule text.
      collectRules((rule as CSSGroupingRule).cssRules, out);
    }
  }
}

function wrapperFor(rule: CSSRule): { open: string; close: string } {
  const opens: string[] = [];
  let parent = rule.parentRule;
  while (parent) {
    if (parent instanceof CSSMediaRule) opens.unshift(`@media ${parent.conditionText} {`);
    parent = parent.parentRule;
  }
  return { open: opens.join(""), close: "}".repeat(opens.length) };
}

function buildOverrides(): string {
  const rootStyle = getComputedStyle(document.documentElement);
  const rules: CSSStyleRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id === STYLE_ID) continue;
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    collectRules(list, rules);
  }

  const css: string[] = [];
  for (const rule of rules) {
    // The minifier merges rules with equal declarations: `.bg-primary,.bg-primary\/5{…}`. Every selector of the
    // list gets its own alpha — a solid one (`.bg-primary`) must never get another selector's transparency.
    for (const selector of splitSelectorList(rule.selectorText)) {
      const alpha = alphaFromSelector(selector);
      if (alpha == null || alpha >= 1) continue;
      const declarations: string[] = [];
      for (const prop of COLOR_PROPS) {
        const raw = rule.style.getPropertyValue(prop);
        if (!raw || raw.includes("color-mix")) continue;
        const resolved = resolveValue(raw, rootStyle);
        if (!resolved) continue;
        const color = parseColor(resolved);
        if (!color) continue;
        const a = Math.round(color[3] * alpha * 1000) / 1000;
        declarations.push(`${prop}: rgba(${color[0]}, ${color[1]}, ${color[2]}, ${a})`);
      }
      if (declarations.length === 0) continue;
      const { open, close } = wrapperFor(rule);
      css.push(`${open}${selector}{${declarations.join(";")}}${close}`);
    }
  }
  if (css.length === 0) return "";
  // Inside the utilities layer (declared earlier, so this block comes last in it): the overrides replace the
  // solid fallbacks at equal specificity but never beat later variants such as `hover:bg-muted` the way
  // unlayered rules would.
  return supportsCascadeLayers() ? `@layer utilities{\n${css.join("\n")}\n}` : css.join("\n");
}

function supportsCascadeLayers() {
  return typeof CSSLayerBlockRule !== "undefined";
}

/** Top-level commas of a selector list (not inside (), [] or escaped). */
export function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectorText.length; index++) {
    const char = selectorText[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(selectorText.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(selectorText.slice(start).trim());
  return parts.filter(Boolean);
}

function apply() {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
  }
  style.textContent = buildOverrides();
  // Always last in <head>, so equal-specificity overrides win.
  document.head.appendChild(style);
}

/** `force` is for checking the fallback in a modern browser (devtools); the app calls it without. */
export function installColorMixFallback({ force = false }: { force?: boolean } = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!force && supportsColorMix()) return;

  let scheduled = 0;
  const schedule = () => {
    if (scheduled) return;
    scheduled = window.setTimeout(() => {
      scheduled = 0;
      apply();
    }, 50);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
  else schedule();
  window.addEventListener("load", schedule, { once: true });

  // New stylesheets (lazy chunks / dev HMR) and theme switches (html class / style).
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        const element = node as Element;
        if (element.id === STYLE_ID) continue;
        if (element.tagName === "STYLE" || (element.tagName === "LINK" && (element as HTMLLinkElement).rel === "stylesheet")) {
          if (element.tagName === "LINK") element.addEventListener("load", schedule, { once: true });
          schedule();
          return;
        }
      }
    }
  }).observe(document.head, { childList: true });
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
}
