/**
 * Shared element box styles for print HTML and the canvas designer.
 * Keep editor and print in lockstep — do not fork font/border/radius/align here.
 */

import type { CSSProperties } from "react";
import type { StyleColorPalette } from "../colorRef";
import { escapeHtmlText } from "../templateVariables";
import { fillToCss, resolveCanvasColor } from "./fill";
import type { CanvasBorder, CanvasElementStyle, Fill } from "./types";

export type CanvasBoxStyleResult = {
  /** Semicolon-joined CSS for print HTML (outer element). */
  outerCss: string;
  /** React style object for the designer outer box. */
  reactStyle: CSSProperties;
  /** When true, wrap inner HTML in a full-width div with text-align. */
  wrapForAlign: boolean;
  align: CanvasElementStyle["align"];
};

function justifyForVerticalAlign(verticalAlign: CanvasElementStyle["verticalAlign"]): string | undefined {
  if (verticalAlign === "middle") return "center";
  if (verticalAlign === "bottom") return "flex-end";
  return undefined;
}

function borderCssParts(border: CanvasBorder, colors: StyleColorPalette | null | undefined): string[] {
  const borderColor = resolveCanvasColor(border.color, colors) ?? "#000000";
  const width = `${border.widthPt}pt`;
  const bstyle = border.style;
  const sides = border.sides?.length ? border.sides : (["top", "right", "bottom", "left"] as const);
  return sides.map((side) => `border-${side}:${width} ${bstyle} ${borderColor}`);
}

function borderReactStyle(border: CanvasBorder, colors: StyleColorPalette | null | undefined): CSSProperties {
  const borderColor = resolveCanvasColor(border.color, colors) ?? "#000000";
  const width = `${border.widthPt}pt`;
  const bstyle = border.style;
  const sides = border.sides?.length ? border.sides : (["top", "right", "bottom", "left"] as const);
  const out: CSSProperties = {};
  for (const side of sides) {
    const key =
      side === "top"
        ? "borderTop"
        : side === "right"
          ? "borderRight"
          : side === "bottom"
            ? "borderBottom"
            : "borderLeft";
    out[key] = `${width} ${bstyle} ${borderColor}`;
  }
  return out;
}

/**
 * Outer box styles. When verticalAlign is middle/bottom, uses flex column + justify-content
 * and leaves text-align to an inner wrapper (see wrapForAlign) so horizontal align works.
 */
export function buildCanvasBoxStyle(
  style: CanvasElementStyle,
  colors: StyleColorPalette | null | undefined,
  options: { overflow?: "hidden" | "visible" } = {},
): CanvasBoxStyleResult {
  const overflow = options.overflow ?? "hidden";
  const color = resolveCanvasColor(style.color, colors);
  const bg = fillToCss(style.background, colors);
  const justify = justifyForVerticalAlign(style.verticalAlign);
  const wrapForAlign = Boolean(justify);

  const cssParts: string[] = [
    `font-size:${style.fontSizePt}pt`,
    `padding:${style.paddingMm}mm`,
    `box-sizing:border-box`,
    `overflow:${overflow}`,
  ];
  if (!wrapForAlign) cssParts.push(`text-align:${style.align}`);
  if (color) cssParts.push(`color:${color}`);
  if (style.bold) cssParts.push("font-weight:700");
  if (style.italic) cssParts.push("font-style:italic");
  if (style.underline) cssParts.push("text-decoration:underline");
  if (style.fontFamily) cssParts.push(`font-family:${escapeHtmlText(style.fontFamily)}`);
  if (style.lineHeight) cssParts.push(`line-height:${style.lineHeight}`);
  if (justify) {
    cssParts.push("display:flex");
    cssParts.push("flex-direction:column");
    cssParts.push(`justify-content:${justify}`);
  }
  if (bg) cssParts.push(`background:${bg}`);
  if (style.radiusMm) cssParts.push(`border-radius:${style.radiusMm}mm`);
  if (style.border) cssParts.push(...borderCssParts(style.border, colors));

  const reactStyle: CSSProperties = {
    fontSize: `${style.fontSizePt}pt`,
    padding: `${style.paddingMm}mm`,
    boxSizing: "border-box",
    overflow,
    ...(wrapForAlign ? {} : { textAlign: style.align }),
    ...(color ? { color } : {}),
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: style.underline ? "underline" : "none",
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(style.lineHeight != null ? { lineHeight: style.lineHeight } : {}),
    ...(justify
      ? { display: "flex", flexDirection: "column", justifyContent: justify as CSSProperties["justifyContent"] }
      : {}),
    ...(bg ? { background: bg } : {}),
    ...(style.radiusMm ? { borderRadius: `${style.radiusMm}mm` } : {}),
    ...(style.border ? borderReactStyle(style.border, colors) : {}),
  };

  return {
    outerCss: cssParts.join(";"),
    reactStyle,
    wrapForAlign,
    align: style.align,
  };
}

/** Inner wrapper so text-align works under flex vertical alignment. */
export function canvasAlignWrapperHtml(inner: string, align: CanvasElementStyle["align"]): string {
  return `<div style="width:100%;text-align:${align}">${inner}</div>`;
}

export function rectElementCss(options: {
  fill?: Fill;
  border?: CanvasBorder;
  radiusMm?: number;
  colors: StyleColorPalette | null | undefined;
}): string {
  const parts: string[] = ["box-sizing:border-box"];
  const fill = fillToCss(options.fill, options.colors);
  if (fill) parts.push(`background:${fill}`);
  if (options.radiusMm) parts.push(`border-radius:${options.radiusMm}mm`);
  if (options.border) {
    const borderColor = resolveCanvasColor(options.border.color, options.colors) ?? "#000000";
    parts.push(`border:${options.border.widthPt}pt ${options.border.style} ${borderColor}`);
  }
  return parts.join(";");
}

export function rectElementReactStyle(options: {
  fill?: Fill;
  border?: CanvasBorder;
  radiusMm?: number;
  colors: StyleColorPalette | null | undefined;
}): CSSProperties {
  const fill = fillToCss(options.fill, options.colors);
  const style: CSSProperties = { boxSizing: "border-box" };
  if (fill) style.background = fill;
  if (options.radiusMm) style.borderRadius = `${options.radiusMm}mm`;
  if (options.border) {
    const borderColor = resolveCanvasColor(options.border.color, options.colors) ?? "#000000";
    style.border = `${options.border.widthPt}pt ${options.border.style} ${borderColor}`;
  }
  return style;
}
