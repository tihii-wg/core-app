/** Type guards and parsers for canvas (v3) layouts. */

import { isColorRef } from "../colorRef";
import type { TableColumn, TableSource, TotalsRow } from "../layout";
import { isCanvasColorRef, isCanvasHexColor, parseFill, clampOpacity } from "./fill";
import {
  CANVAS_ELEMENT_TYPES,
  type CanvasBorder,
  type CanvasDocumentLayout,
  type CanvasElement,
  type CanvasElementStyle,
  type CanvasGridMm,
  type CanvasPage,
  type ImageCanvasElement,
  type LineCanvasElement,
  type PageNumberCanvasElement,
  type QrCanvasElement,
  type RectCanvasElement,
  type SignaturesCanvasElement,
  type TableCanvasElement,
  type TextCanvasElement,
  type TotalsCanvasElement,
  type VariableCanvasElement,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBorder(value: unknown): CanvasBorder | undefined {
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.widthPt) || value.widthPt < 0) return undefined;
  if (!isCanvasColorRef(value.color)) return undefined;
  if (value.style !== "solid" && value.style !== "dashed" && value.style !== "dotted") return undefined;
  const sides = Array.isArray(value.sides)
    ? value.sides.filter(
        (side): side is "top" | "right" | "bottom" | "left" =>
          side === "top" || side === "right" || side === "bottom" || side === "left",
      )
    : undefined;
  return {
    widthPt: value.widthPt,
    color: String(value.color).trim(),
    style: value.style,
    ...(sides && sides.length > 0 ? { sides } : {}),
  };
}

function parseElementStyle(value: unknown): CanvasElementStyle | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.fontSizePt) || value.fontSizePt < 4 || value.fontSizePt > 72) return null;
  if (!isCanvasColorRef(value.color)) return null;
  if (value.align !== "left" && value.align !== "center" && value.align !== "right") return null;
  if (!isFiniteNumber(value.paddingMm) || value.paddingMm < 0) return null;
  if (value.verticalAlign != null && value.verticalAlign !== "top" && value.verticalAlign !== "middle" && value.verticalAlign !== "bottom") {
    return null;
  }
  if (value.fontFamily != null && typeof value.fontFamily !== "string") return null;
  if (value.lineHeight != null && (!isFiniteNumber(value.lineHeight) || value.lineHeight <= 0)) return null;
  if (value.radiusMm != null && (!isFiniteNumber(value.radiusMm) || value.radiusMm < 0)) return null;
  if (value.bold != null && typeof value.bold !== "boolean") return null;
  if (value.italic != null && typeof value.italic !== "boolean") return null;
  if (value.underline != null && typeof value.underline !== "boolean") return null;
  const background = value.background === undefined ? undefined : parseFill(value.background);
  if (value.background !== undefined && !background) return null;
  const border = value.border === undefined ? undefined : parseBorder(value.border);
  if (value.border !== undefined && !border) return null;
  return {
    fontSizePt: value.fontSizePt,
    color: String(value.color).trim(),
    align: value.align,
    paddingMm: value.paddingMm,
    ...(value.bold ? { bold: true } : {}),
    ...(value.italic ? { italic: true } : {}),
    ...(value.underline ? { underline: true } : {}),
    ...(value.verticalAlign ? { verticalAlign: value.verticalAlign } : {}),
    ...(typeof value.fontFamily === "string" ? { fontFamily: value.fontFamily } : {}),
    ...(background ? { background } : {}),
    ...(border ? { border } : {}),
    ...(isFiniteNumber(value.radiusMm) ? { radiusMm: value.radiusMm } : {}),
    ...(isFiniteNumber(value.lineHeight) ? { lineHeight: value.lineHeight } : {}),
  };
}

const TABLE_SOURCES = new Set<TableSource>([
  "services",
  "materials",
  "allLines",
  "invoiceLines",
  "invoiceWorks",
  "invoiceMaterials",
]);

const TABLE_KEYS = new Set([
  "index",
  "name",
  "sku",
  "qty",
  "unit",
  "price",
  "discount",
  "vat",
  "sum",
  "warranty",
  "performer",
]);

const TOTALS_KEYS = new Set([
  "servicesSum",
  "materialsSum",
  "discount",
  "vat",
  "total",
  "paid",
  "remaining",
  "totalWords",
]);

function parseTableColumns(value: unknown): TableCanvasElement["columns"] | null {
  if (!Array.isArray(value)) return null;
  const columns: TableCanvasElement["columns"] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.key !== "string" || !TABLE_KEYS.has(item.key)) return null;
    if (typeof item.label !== "string") return null;
    if (typeof item.enabled !== "boolean") return null;
    if (item.widthPercent != null && (!isFiniteNumber(item.widthPercent) || item.widthPercent <= 0)) return null;
    if (item.align != null && item.align !== "left" && item.align !== "center" && item.align !== "right") return null;
    columns.push({
      key: item.key as TableColumn["key"],
      label: item.label,
      enabled: item.enabled,
      ...(isFiniteNumber(item.widthPercent) ? { widthPercent: item.widthPercent } : {}),
      ...(item.align ? { align: item.align } : {}),
    });
  }
  return columns;
}

function parseTotalsRows(value: unknown): TotalsRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: TotalsRow[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.key !== "string" || !TOTALS_KEYS.has(item.key)) return null;
    if (typeof item.label !== "string") return null;
    if (typeof item.enabled !== "boolean") return null;
    rows.push({ key: item.key as TotalsRow["key"], label: item.label, enabled: item.enabled });
  }
  return rows;
}

function parseBase(
  value: Record<string, unknown>,
): Omit<CanvasElement, "type"> & { type: string } | null {
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.type !== "string" || !(CANVAS_ELEMENT_TYPES as readonly string[]).includes(value.type)) return null;
  if (!isFiniteNumber(value.xMm) || !isFiniteNumber(value.yMm) || !isFiniteNumber(value.wMm) || !isFiniteNumber(value.hMm)) {
    return null;
  }
  if (value.wMm <= 0 || value.hMm <= 0) return null;
  if (!isFiniteNumber(value.zIndex)) return null;
  if (value.locked != null && typeof value.locked !== "boolean") return null;
  if (value.repeatOnEveryPage != null && typeof value.repeatOnEveryPage !== "boolean") return null;
  const style = parseElementStyle(value.style);
  if (!style) return null;
  return {
    id: value.id,
    type: value.type,
    xMm: value.xMm,
    yMm: value.yMm,
    wMm: value.wMm,
    hMm: value.hMm,
    zIndex: value.zIndex,
    style,
    ...(value.locked ? { locked: true } : {}),
    ...(value.repeatOnEveryPage ? { repeatOnEveryPage: true } : {}),
  };
}

function parseElement(value: unknown): CanvasElement | null {
  if (!isRecord(value)) return null;
  const base = parseBase(value);
  if (!base) return null;

  switch (base.type) {
    case "text": {
      if (typeof value.content !== "string") return null;
      return { ...base, type: "text", content: value.content } satisfies TextCanvasElement;
    }
    case "variable": {
      if (typeof value.token !== "string" || !value.token.trim()) return null;
      if (value.label != null && typeof value.label !== "string") return null;
      if (value.labelPosition != null && value.labelPosition !== "left" && value.labelPosition !== "top") return null;
      if (value.labelBold != null && typeof value.labelBold !== "boolean") return null;
      if (value.labelColor != null && !isCanvasColorRef(value.labelColor)) return null;
      if (value.hideIfEmpty != null && typeof value.hideIfEmpty !== "boolean") return null;
      return {
        ...base,
        type: "variable",
        token: value.token.trim(),
        ...(typeof value.label === "string" ? { label: value.label } : {}),
        ...(value.labelPosition === "left" || value.labelPosition === "top" ? { labelPosition: value.labelPosition } : {}),
        ...(value.labelBold ? { labelBold: true } : {}),
        ...(isCanvasColorRef(value.labelColor) ? { labelColor: String(value.labelColor).trim() } : {}),
        ...(value.hideIfEmpty === false ? { hideIfEmpty: false } : value.hideIfEmpty ? { hideIfEmpty: true } : {}),
      } satisfies VariableCanvasElement;
    }
    case "table": {
      if (typeof value.source !== "string" || !TABLE_SOURCES.has(value.source as TableSource)) return null;
      const columns = parseTableColumns(value.columns);
      if (!columns) return null;
      if (typeof value.showTotalsRow !== "boolean") return null;
      if (!isCanvasColorRef(value.headerBackground) || !isCanvasColorRef(value.headerTextColor)) return null;
      if (!isCanvasColorRef(value.borderColor)) return null;
      if (value.borders !== "all" && value.borders !== "horizontal" && value.borders !== "none") return null;
      if (value.rowBackground != null && !isCanvasColorRef(value.rowBackground)) return null;
      if (value.zebraBackground != null && !isCanvasColorRef(value.zebraBackground)) return null;
      if (value.totalsRowBackground != null && !isCanvasColorRef(value.totalsRowBackground)) return null;
      if (value.totalsRowTextColor != null && !isCanvasColorRef(value.totalsRowTextColor)) return null;
      return {
        ...base,
        type: "table",
        source: value.source as TableSource,
        columns,
        showTotalsRow: value.showTotalsRow,
        headerBackground: String(value.headerBackground).trim(),
        headerTextColor: String(value.headerTextColor).trim(),
        borderColor: String(value.borderColor).trim(),
        borders: value.borders,
        ...(isCanvasColorRef(value.rowBackground) ? { rowBackground: String(value.rowBackground).trim() } : {}),
        ...(isCanvasColorRef(value.zebraBackground) ? { zebraBackground: String(value.zebraBackground).trim() } : {}),
        ...(isCanvasColorRef(value.totalsRowBackground)
          ? { totalsRowBackground: String(value.totalsRowBackground).trim() }
          : {}),
        ...(isCanvasColorRef(value.totalsRowTextColor) ? { totalsRowTextColor: String(value.totalsRowTextColor).trim() } : {}),
      } satisfies TableCanvasElement;
    }
    case "totals": {
      const rows = parseTotalsRows(value.rows);
      if (!rows) return null;
      if (value.background != null && !isCanvasColorRef(value.background)) return null;
      if (value.textColor != null && !isCanvasColorRef(value.textColor)) return null;
      if (value.grandTotalBackground != null && !isCanvasColorRef(value.grandTotalBackground)) return null;
      if (value.grandTotalTextColor != null && !isCanvasColorRef(value.grandTotalTextColor)) return null;
      return {
        ...base,
        type: "totals",
        rows,
        ...(isCanvasColorRef(value.background) ? { background: String(value.background).trim() } : {}),
        ...(isCanvasColorRef(value.textColor) ? { textColor: String(value.textColor).trim() } : {}),
        ...(isCanvasColorRef(value.grandTotalBackground)
          ? { grandTotalBackground: String(value.grandTotalBackground).trim() }
          : {}),
        ...(isCanvasColorRef(value.grandTotalTextColor)
          ? { grandTotalTextColor: String(value.grandTotalTextColor).trim() }
          : {}),
      } satisfies TotalsCanvasElement;
    }
    case "rect": {
      const fill = value.fill === undefined ? undefined : parseFill(value.fill);
      if (value.fill !== undefined && !fill) return null;
      const border = value.border === undefined ? undefined : parseBorder(value.border);
      if (value.border !== undefined && !border) return null;
      if (value.radiusMm != null && (!isFiniteNumber(value.radiusMm) || value.radiusMm < 0)) return null;
      return {
        ...base,
        type: "rect",
        ...(fill ? { fill } : {}),
        ...(border ? { border } : {}),
        ...(isFiniteNumber(value.radiusMm) ? { radiusMm: value.radiusMm } : {}),
      } satisfies RectCanvasElement;
    }
    case "image": {
      if (value.source !== "logo" && value.source !== "url") return null;
      if (value.url != null && typeof value.url !== "string") return null;
      if (value.objectFit != null && value.objectFit !== "contain" && value.objectFit !== "cover" && value.objectFit !== "fill") {
        return null;
      }
      return {
        ...base,
        type: "image",
        source: value.source,
        ...(typeof value.url === "string" ? { url: value.url } : {}),
        ...(value.objectFit ? { objectFit: value.objectFit } : {}),
      } satisfies ImageCanvasElement;
    }
    case "line": {
      if (value.orientation !== "horizontal" && value.orientation !== "vertical") return null;
      if (!isFiniteNumber(value.thicknessPt) || value.thicknessPt <= 0) return null;
      if (!isCanvasColorRef(value.color)) return null;
      return {
        ...base,
        type: "line",
        orientation: value.orientation,
        thicknessPt: value.thicknessPt,
        color: String(value.color).trim(),
      } satisfies LineCanvasElement;
    }
    case "signatures": {
      if (!Array.isArray(value.labels) || !value.labels.every((label) => typeof label === "string")) return null;
      if (value.dateLabel != null && typeof value.dateLabel !== "string") return null;
      return {
        ...base,
        type: "signatures",
        labels: value.labels as string[],
        ...(typeof value.dateLabel === "string" ? { dateLabel: value.dateLabel } : {}),
      } satisfies SignaturesCanvasElement;
    }
    case "qr": {
      if (value.contentToken != null && typeof value.contentToken !== "string") return null;
      return {
        ...base,
        type: "qr",
        ...(typeof value.contentToken === "string" ? { contentToken: value.contentToken } : {}),
      } satisfies QrCanvasElement;
    }
    case "pageNumber": {
      if (value.format != null && typeof value.format !== "string") return null;
      return {
        ...base,
        type: "pageNumber",
        ...(typeof value.format === "string" ? { format: value.format } : {}),
      } satisfies PageNumberCanvasElement;
    }
    default:
      return null;
  }
}

function parsePage(value: unknown): CanvasPage | null {
  if (!isRecord(value)) return null;
  if (value.size !== "A4" && value.size !== "A5") return null;
  if (value.orientation !== "portrait" && value.orientation !== "landscape") return null;
  if (!isFiniteNumber(value.marginsMm) || value.marginsMm < 0 || value.marginsMm > 50) return null;
  const background = value.background === undefined ? undefined : parseFill(value.background);
  if (value.background !== undefined && !background) return null;
  return {
    size: value.size,
    orientation: value.orientation,
    marginsMm: value.marginsMm,
    ...(background ? { background } : {}),
  };
}

/** Type guard for persisted canvas layout JSON. Rejects non-hex / unsafe colors. */
export function isCanvasDocumentLayout(value: unknown): value is CanvasDocumentLayout {
  if (!isRecord(value)) return false;
  if (value.version !== 3 || value.mode !== "canvas") return false;
  if (value.gridMm !== 1 && value.gridMm !== 2 && value.gridMm !== 5) return false;
  if (value.useStyle != null && typeof value.useStyle !== "boolean") return false;
  if (!parsePage(value.page)) return false;
  if (!Array.isArray(value.elements)) return false;
  return value.elements.every((element) => parseElement(element) != null);
}

export function parseCanvasDocumentLayout(value: unknown): CanvasDocumentLayout | null {
  if (!isCanvasDocumentLayout(value)) return null;
  const page = parsePage(value.page);
  if (!page) return null;
  const elements = value.elements
    .map((element) => parseElement(element))
    .filter((element): element is CanvasElement => element != null);
  return {
    version: 3,
    mode: "canvas",
    page,
    gridMm: value.gridMm as CanvasGridMm,
    elements,
    ...(value.useStyle != null ? { useStyle: value.useStyle } : {}),
  };
}

/** Rejects 3-digit hex and out-of-range opacity for canvas ColorRefs / fills. */
export function assertCanvasColorSafe(value: unknown): boolean {
  if (typeof value === "string") return isCanvasColorRef(value) || isColorRef(value);
  if (isRecord(value) && "color" in value) {
    if (!isCanvasColorRef(value.color)) return false;
    if (value.opacity != null && clampOpacity(value.opacity) == null) return false;
    if (typeof value.opacity === "number" && (value.opacity < 0 || value.opacity > 1)) return false;
    return true;
  }
  return isCanvasHexColor(String(value ?? ""));
}
