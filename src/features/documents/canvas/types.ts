/**
 * Version-3 canvas (WYSIWYG) document layout model.
 * Coordinates (xMm/yMm) are millimetres from the content-box top-left (inside page margins),
 * matching print placement inside `@page` margin + `.canvas-page`.
 */

import type { ColorRef } from "../colorRef";
import type {
  PageOrientation,
  PageSize,
  TableColumn,
  TableSource,
  TotalsRow,
} from "../layout";

export type CanvasGridMm = 1 | 2 | 5;

export type Fill = {
  color: ColorRef;
  /** 0–1; omitted = opaque. */
  opacity?: number;
};

export type BorderSide = "top" | "right" | "bottom" | "left";

export type CanvasBorder = {
  widthPt: number;
  color: ColorRef;
  style: "solid" | "dashed" | "dotted";
  sides?: BorderSide[];
};

export type CanvasElementStyle = {
  fontSizePt: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color: ColorRef;
  align: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  fontFamily?: string;
  background?: Fill;
  border?: CanvasBorder;
  radiusMm?: number;
  paddingMm: number;
  lineHeight?: number;
};

export type CanvasElementBase = {
  id: string;
  type: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  zIndex: number;
  locked?: boolean;
  repeatOnEveryPage?: boolean;
  style: CanvasElementStyle;
};

export type TextCanvasElement = CanvasElementBase & {
  type: "text";
  content: string;
};

export type VariableCanvasElement = CanvasElementBase & {
  type: "variable";
  token: string;
  label?: string;
  labelPosition?: "left" | "top";
  labelBold?: boolean;
  labelColor?: ColorRef;
  hideIfEmpty?: boolean;
};

export type TableCanvasElement = CanvasElementBase & {
  type: "table";
  source: TableSource;
  columns: Array<TableColumn & { align?: "left" | "center" | "right" }>;
  showTotalsRow: boolean;
  headerBackground: ColorRef;
  headerTextColor: ColorRef;
  rowBackground?: ColorRef;
  zebraBackground?: ColorRef;
  borderColor: ColorRef;
  totalsRowBackground?: ColorRef;
  totalsRowTextColor?: ColorRef;
  borders: "all" | "horizontal" | "none";
  /** Optional radius for header row top corners (mm); outer box still uses style.radiusMm. */
  headerRadiusMm?: number;
};

export type TotalsCanvasElement = CanvasElementBase & {
  type: "totals";
  rows: TotalsRow[];
  background?: ColorRef;
  textColor?: ColorRef;
  grandTotalBackground?: ColorRef;
  grandTotalTextColor?: ColorRef;
  /** Optional radius for the grand-total row background (mm). */
  grandTotalRadiusMm?: number;
};

export type RectCanvasElement = CanvasElementBase & {
  type: "rect";
  fill?: Fill;
  border?: CanvasBorder;
  radiusMm?: number;
};

export type ImageCanvasElement = CanvasElementBase & {
  type: "image";
  /** "logo" uses workspace/company logo from print context. */
  source: "logo" | "url";
  url?: string;
  objectFit?: "contain" | "cover" | "fill";
};

export type LineCanvasElement = CanvasElementBase & {
  type: "line";
  orientation: "horizontal" | "vertical";
  thicknessPt: number;
  color: ColorRef;
};

export type SignaturesCanvasElement = CanvasElementBase & {
  type: "signatures";
  labels: string[];
  dateLabel?: string;
};

export type QrCanvasElement = CanvasElementBase & {
  type: "qr";
  /** Resolves public order URL from print context when omitted. */
  contentToken?: string;
};

export type PageNumberCanvasElement = CanvasElementBase & {
  type: "pageNumber";
  /** Template with {n} and {m}; default localised at render. */
  format?: string;
};

export type CanvasElement =
  | TextCanvasElement
  | VariableCanvasElement
  | TableCanvasElement
  | TotalsCanvasElement
  | RectCanvasElement
  | ImageCanvasElement
  | LineCanvasElement
  | SignaturesCanvasElement
  | QrCanvasElement
  | PageNumberCanvasElement;

export type CanvasPage = {
  size: PageSize;
  orientation: PageOrientation;
  marginsMm: number;
  background?: Fill;
};

export type CanvasDocumentLayout = {
  version: 3;
  mode: "canvas";
  page: CanvasPage;
  gridMm: CanvasGridMm;
  elements: CanvasElement[];
  /** When true, theme:* ColorRefs resolve from the workspace Document style. */
  useStyle?: boolean;
};

export type AnyDocumentLayout = import("../layout").DocumentLayout | CanvasDocumentLayout;

export const CANVAS_ELEMENT_TYPES = [
  "text",
  "variable",
  "table",
  "totals",
  "rect",
  "image",
  "line",
  "signatures",
  "qr",
  "pageNumber",
] as const;

export type CanvasElementType = (typeof CANVAS_ELEMENT_TYPES)[number];

export function newCanvasElementId(prefix = "el"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Page size in millimetres (ISO 216). */
export function pageSizeMm(size: PageSize, orientation: PageOrientation): { widthMm: number; heightMm: number } {
  const base = size === "A5" ? { widthMm: 148, heightMm: 210 } : { widthMm: 210, heightMm: 297 };
  if (orientation === "landscape") return { widthMm: base.heightMm, heightMm: base.widthMm };
  return base;
}
