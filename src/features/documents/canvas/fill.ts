/** Fill / ColorRef helpers for canvas layouts. Hex must be 6-digit; theme refs allowed. */

import {
  isThemeColorRef,
  resolveColorRef,
  type ColorRef,
  type StyleColorPalette,
} from "../colorRef";
import type { Fill } from "./types";

/** Canvas fills reject 3-digit hex — only `#rrggbb`. */
export const CANVAS_HEX = /^#[0-9a-fA-F]{6}$/;

export function isCanvasHexColor(value: string): boolean {
  return CANVAS_HEX.test(value.trim());
}

export function isCanvasColorRef(value: unknown): value is ColorRef {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return isCanvasHexColor(trimmed) || isThemeColorRef(trimmed);
}

export function clampOpacity(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

export function parseFill(value: unknown): Fill | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!isCanvasColorRef(record.color)) return undefined;
  if (record.opacity != null) {
    if (typeof record.opacity !== "number" || !Number.isFinite(record.opacity) || record.opacity < 0 || record.opacity > 1) {
      return undefined;
    }
  }
  const opacity = clampOpacity(record.opacity);
  return opacity == null ? { color: record.color.trim() } : { color: record.color.trim(), opacity };
}

/** Resolve Fill to CSS background (hex + alpha). */
export function fillToCss(fill: Fill | undefined, colors: StyleColorPalette | null | undefined): string | undefined {
  if (!fill) return undefined;
  const hex = colors ? resolveColorRef(fill.color, colors) : isCanvasHexColor(fill.color) ? fill.color.trim() : undefined;
  if (!hex) return undefined;
  const opacity = fill.opacity;
  if (opacity == null || opacity >= 1) return hex;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function resolveCanvasColor(
  ref: ColorRef | undefined,
  colors: StyleColorPalette | null | undefined,
): string | undefined {
  if (!ref) return undefined;
  if (colors) return resolveColorRef(ref, colors);
  return isCanvasHexColor(ref) ? ref.trim() : undefined;
}
