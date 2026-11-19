/** Print-accurate HTML renderer for canvas (v3) layouts. Coordinates in mm; print-color-adjust: exact. */

import QRCode from "qrcode";
import type { StyleColorPalette } from "../colorRef";
import { formatQuantity } from "../../../lib/quantity";
import { vatIncludedAmount } from "../../finance/vat";
import { applyTemplateVariables, PRINT_DEFAULT_FONT_STACK } from "../printTemplate";
import { escapeHtmlText, printContextVatBreakdown, type PrintContext } from "../templateVariables";
import {
  buildCanvasBoxStyle,
  canvasAlignWrapperHtml,
  canvasElementBoxStyle,
  rectElementCss,
} from "./canvasElementStyle";
import { fillToCss, resolveCanvasColor } from "./fill";
import {
  canvasRowsForSource,
  canvasTotalsRowVisible,
  canvasTotalsValue,
  estimateTableHeightMm,
  estimateTotalsHeightMm,
  formatCanvasMoney,
  type CanvasLineRow,
} from "./tableData";
import {
  pageSizeMm,
  type CanvasDocumentLayout,
  type CanvasElement,
  type TableCanvasElement,
  type TotalsCanvasElement,
} from "./types";

/**
 * Line height of every canvas element on paper AND on the designer sheet. The app UI uses 1.5 and the print
 * document the browser default; without one shared value text wrapped and stacked differently in the printout.
 */
export const CANVAS_LINE_HEIGHT = 1.2;

export type RenderCanvasOptions = {
  showCents?: boolean;
  colors?: StyleColorPalette | null;
  /** When true, leave tokens unresolved (designer "token" mode). */
  showTokens?: boolean;
};

type Placed = {
  element: CanvasElement;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
};

/** Elements that grow with their data (text / variables wrap, tables add rows, totals add lines). */
const GROWABLE_TYPES = new Set<CanvasElement["type"]>(["text", "variable", "table", "totals"]);

/** Ignore sub-0.1 mm differences (measurement noise). */
const GROWTH_EPSILON_MM = 0.1;

const PX_PER_MM = 96 / 25.4;
const MEASURE_ROOT_ID = "__canvas-measure-root";
const measureCache = new Map<string, number | null>();

/**
 * Natural height (mm) of an element's content at its width, measured by the browser exactly as it will print
 * (same inner HTML and box style). `null` when there is no layout engine (tests / server) — callers estimate.
 */
function measureContentHeightMm(innerHtml: string, widthMm: number, boxCss: string): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const key = `${widthMm}|${boxCss}|${innerHtml}`;
  if (measureCache.has(key)) return measureCache.get(key) ?? null;
  let root = document.getElementById(MEASURE_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = MEASURE_ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    root.style.cssText =
      `position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;` +
      `font-family:${PRINT_DEFAULT_FONT_STACK};font-size:13px;color:#111;line-height:${CANVAS_LINE_HEIGHT}`;
    document.body.appendChild(root);
  }
  const box = document.createElement("div");
  box.style.cssText = `${boxCss};position:static;display:block;width:${widthMm}mm;height:auto;min-height:0;max-height:none;overflow:visible`;
  box.innerHTML = innerHtml;
  root.appendChild(box);
  const px = box.getBoundingClientRect().height;
  root.removeChild(box);
  // No layout engine (jsdom reports 0): fall back to estimates.
  const mm = px > 0 ? px / PX_PER_MM : innerHtml.trim() ? null : 0;
  if (measureCache.size > 600) measureCache.clear();
  measureCache.set(key, mm);
  return mm;
}

export type GrowthOptions = {
  colors?: StyleColorPalette | null;
  showCents?: boolean;
  showTokens?: boolean;
  /** Default true. The designer turns it off in "field names" mode (text shows chips, not data). */
  growText?: boolean;
};

/** Height an element needs for its data; `null` = keep the designed height. */
function contentHeightMm(item: Placed, ctx: PrintContext, options: GrowthOptions): number | null {
  const element = item.element;
  const colors = options.colors ?? null;
  const showCents = options.showCents !== false;
  const showTokens = options.showTokens === true;
  const measured = () => {
    const inner = renderCanvasElementInnerHtml(element, ctx, colors, showCents, showTokens, 0, 1);
    const box = buildCanvasBoxStyle(canvasElementBoxStyle(element), colors, { overflow: "visible" });
    return measureContentHeightMm(inner, item.wMm, box.outerCss);
  };
  if (element.type === "table") {
    // A table is exactly as tall as its rows (rows keep one height; the box no longer stretches them).
    const exact = measured();
    if (exact != null) return exact;
    const rows = canvasRowsForSource(element.source, ctx);
    return estimateTableHeightMm(
      rows.length,
      element.showTotalsRow,
      0,
      element.showHeader !== false,
      element.style.fontSizePt,
      element.style.lineHeight ?? CANVAS_LINE_HEIGHT,
    );
  }
  if (element.type === "totals") {
    const exact = measured();
    if (exact != null) return Math.max(item.hMm, exact);
    const visibleRows = element.rows.filter((row) => row.enabled && canvasTotalsRowVisible(row.key, ctx));
    return estimateTotalsHeightMm(visibleRows.length, item.hMm, visibleRows);
  }
  // Text / variables: grow when the data wraps to more lines (beyond a 0.5 mm font tolerance), never shrink.
  const exact = measured();
  return exact == null || exact <= item.hMm + 0.5 ? null : exact;
}

/**
 * Flow layout for print: tables / totals / text / variables take the height their data needs, and every block
 * below a changed element (overlapping it horizontally) moves by the same amount — down when it grew, up when a
 * table is shorter than its designed box. A background rectangle that encloses a growing element grows with it.
 * Elements repeated on every page (page number…) keep their place.
 */
export function applyTableGrowthShifts(elements: CanvasElement[], ctx: PrintContext, options: GrowthOptions = {}): Placed[] {
  const placed: Placed[] = elements.map((element) => ({
    element,
    xMm: element.xMm,
    yMm: element.yMm,
    wMm: element.wMm,
    hMm: element.hMm,
  }));

  const growable = placed
    .filter(
      (item) =>
        GROWABLE_TYPES.has(item.element.type) &&
        !item.element.repeatOnEveryPage &&
        (options.growText !== false || item.element.type === "table" || item.element.type === "totals"),
    )
    .sort((a, b) => a.yMm - b.yMm || a.xMm - b.xMm);

  for (const item of growable) {
    const target = contentHeightMm(item, ctx, options);
    if (target == null) continue;
    const extra = target - item.hMm;
    if (Math.abs(extra) < GROWTH_EPSILON_MM) continue;
    const originalTop = item.yMm;
    const originalBottom = item.yMm + item.hMm;
    item.hMm = Math.max(0, target);

    // Background boxes around the element (e.g. a tinted client block) follow its height.
    const containers = placed.filter(
      (other) =>
        other !== item &&
        other.element.type === "rect" &&
        !other.element.repeatOnEveryPage &&
        other.xMm <= item.xMm + 0.01 &&
        other.xMm + other.wMm >= item.xMm + item.wMm - 0.01 &&
        other.yMm <= originalTop + 0.01 &&
        other.yMm + other.hMm >= originalBottom - 0.01,
    );
    for (const container of containers) container.hMm = Math.max(0, container.hMm + extra);

    const spanLeft = Math.min(item.xMm, ...containers.map((c) => c.xMm));
    const spanRight = Math.max(item.xMm + item.wMm, ...containers.map((c) => c.xMm + c.wMm));
    for (const other of placed) {
      if (other === item || containers.includes(other) || other.element.repeatOnEveryPage) continue;
      const overlapsColumn = other.xMm < spanRight - 0.01 && other.xMm + other.wMm > spanLeft + 0.01;
      if (overlapsColumn && other.yMm >= originalBottom - 0.01) other.yMm = Math.max(0, other.yMm + extra);
    }
  }

  return placed;
}

function paginate(
  placed: Placed[],
  pageContentHeightMm: number,
): Array<{ pageIndex: number; items: Placed[]; pageOffsetY: number }> {
  if (placed.length === 0) return [{ pageIndex: 0, items: [], pageOffsetY: 0 }];

  const maxBottom = placed.reduce((max, item) => Math.max(max, item.yMm + item.hMm), 0);
  const pageCount = Math.max(1, Math.ceil(maxBottom / pageContentHeightMm));
  const pages: Array<{ pageIndex: number; items: Placed[]; pageOffsetY: number }> = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const pageTop = pageIndex * pageContentHeightMm;
    const pageBottom = pageTop + pageContentHeightMm;
    const items: Placed[] = [];

    for (const item of placed) {
      if (item.element.repeatOnEveryPage) {
        items.push({
          ...item,
          yMm: item.yMm, // absolute within first-page coords; adjusted when rendering
        });
        continue;
      }
      const itemBottom = item.yMm + item.hMm;
      if (itemBottom <= pageTop + 0.01 || item.yMm >= pageBottom - 0.01) continue;
      items.push(item);
    }

    pages.push({ pageIndex, items, pageOffsetY: pageTop });
  }

  return pages;
}

/** @deprecated Prefer buildCanvasBoxStyle — kept as a thin alias for older tests. */
export function styleFontCss(
  style: import("./types").CanvasElementStyle,
  colors: StyleColorPalette | null | undefined,
): string {
  return buildCanvasBoxStyle(style, colors).outerCss;
}

function applyText(text: string, ctx: PrintContext, showCents: boolean, showTokens: boolean): string {
  // Escape static text first so raw HTML in content cannot inject; tokens (#…) survive escaping.
  const escaped = escapeHtmlText(text);
  if (showTokens) return escaped.replace(/\n/g, "<br/>");
  return applyTemplateVariables(escaped, ctx, {
    showCents,
    currency: ctx.currency,
    locale: ctx.locale,
  }).replace(/\n/g, "<br/>");
}

function cellBorderCss(borders: TableCanvasElement["borders"], borderColor: string): string {
  if (borders === "none") return "border:none";
  if (borders === "horizontal") return `border:none;border-bottom:1pt solid ${borderColor}`;
  return `border:1pt solid ${borderColor}`;
}

function renderTableHtml(
  el: TableCanvasElement,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  rowsSlice: CanvasLineRow[],
  startIndex: number,
  includeHeader: boolean,
): string {
  const columns = el.columns.filter((column) => column.enabled);
  if (columns.length === 0) return "";
  const borderColor = resolveCanvasColor(el.borderColor, colors) ?? "#cccccc";
  const headerBg = resolveCanvasColor(el.headerBackground, colors) ?? "#1a6de0";
  const headerFg = resolveCanvasColor(el.headerTextColor, colors) ?? "#ffffff";
  const rowBg = resolveCanvasColor(el.rowBackground, colors);
  const zebraBg = resolveCanvasColor(el.zebraBackground, colors);
  const totalsBg = resolveCanvasColor(el.totalsRowBackground, colors);
  const totalsFg = resolveCanvasColor(el.totalsRowTextColor, colors);
  const cellBorder = cellBorderCss(el.borders, borderColor);
  const outerRadius = el.style.radiusMm ?? 0;
  const headerRadius = el.headerRadiusMm ?? outerRadius;
  const tableRadiusCss = outerRadius
    ? `border-collapse:separate;border-spacing:0;overflow:hidden;border-radius:${outerRadius}mm`
    : "border-collapse:collapse";

  // No height:100%: rows keep their natural height; the element takes the table height (flow layout).
  let html = `<table style="width:100%;${tableRadiusCss}">`;
  if (includeHeader && el.showHeader !== false) {
    html += "<thead><tr>";
    columns.forEach((column, colIndex) => {
      const width = column.widthPercent ? `width:${column.widthPercent}%` : "";
      const align = column.align ?? "left";
      const corner =
        headerRadius > 0
          ? colIndex === 0
            ? `border-top-left-radius:${headerRadius}mm;`
            : colIndex === columns.length - 1
              ? `border-top-right-radius:${headerRadius}mm;`
              : ""
          : "";
      html += `<th style="${cellBorder};padding:2mm 1.5mm;text-align:${align};background:${headerBg};color:${headerFg};${corner}${width}">${escapeHtmlText(column.label)}</th>`;
    });
    html += "</tr></thead>";
  }
  html += "<tbody>";
  let total = 0;
  rowsSlice.forEach((row, index) => {
    total += row.sum;
    const absIndex = startIndex + index;
    const bg =
      zebraBg && absIndex % 2 === 1
        ? `background:${zebraBg}`
        : rowBg
          ? `background:${rowBg}`
          : "";
    html += `<tr${bg ? ` style="${bg}"` : ""}>`;
    for (const column of columns) {
      const align =
        column.align ??
        (column.key === "name" ||
        column.key === "sku" ||
        column.key === "warranty" ||
        column.key === "performer" ||
        column.key === "comment"
          ? "left"
          : "right");
      let value = "";
      switch (column.key) {
        case "index":
          value = String(absIndex + 1);
          break;
        case "name":
          value = escapeHtmlText(row.name);
          break;
        case "sku":
          value = escapeHtmlText(row.sku);
          break;
        case "qty":
          value = formatQuantity(Number(row.qty) || 0, ctx.locale);
          break;
        case "unit":
          value = escapeHtmlText(row.unit);
          break;
        case "price":
          value = formatCanvasMoney(row.price, ctx, showCents);
          break;
        case "discount":
          value = escapeHtmlText(row.discount);
          break;
        case "vat": {
          const vat = printContextVatBreakdown(ctx);
          value = vat
            ? formatCanvasMoney(vatIncludedAmount(row.sum, vat.rate), ctx, showCents)
            : "";
          break;
        }
        case "sum":
          value = formatCanvasMoney(row.sum, ctx, showCents);
          break;
        case "warranty":
          value = escapeHtmlText(row.warranty);
          break;
        case "performer":
          value = escapeHtmlText(row.performer);
          break;
        case "comment":
          value = escapeHtmlText(row.comment);
          break;
      }
      html += `<td style="${cellBorder};padding:1.5mm;text-align:${align}">${value}</td>`;
    }
    html += "</tr>";
  });
  if (el.showTotalsRow && rowsSlice.length > 0) {
    const bg = totalsBg ? `background:${totalsBg}` : "";
    const fg = totalsFg ? `color:${totalsFg}` : "";
    html += `<tr style="${bg};${fg}"><td colspan="${Math.max(columns.length - 1, 1)}" style="${cellBorder};padding:1.5mm;text-align:right;font-weight:700">Σ</td>`;
    html += `<td style="${cellBorder};padding:1.5mm;text-align:right;font-weight:700">${formatCanvasMoney(total, ctx, showCents)}</td></tr>`;
  }
  html += "</tbody></table>";
  return html;
}

function isWordsTotalsKey(key: TotalsCanvasElement["rows"][number]["key"]): boolean {
  return key === "totalWords" || key === "paidWords" || key === "remainingWords";
}

function renderSignaturesHtml(element: Extract<CanvasElement, { type: "signatures" }>): string {
  const nameLine = escapeHtmlText("/ ФИО /");
  const stamp = escapeHtmlText("М.П.");
  const cells = element.labels
    .map((label, index) => {
      const isExecutor = index === 0;
      // Hidden line keeps its height (space to sign); hidden name / stamp are dropped.
      const line = element.hideLine
        ? `<div style="height:10mm;margin-bottom:1mm"></div>`
        : `<div style="border-bottom:1pt solid #333;height:10mm;margin-bottom:1mm"></div>`;
      const name = element.hideName ? "" : `<div style="font-size:0.85em;color:#444">${nameLine}</div>`;
      const stampHtml = element.hideStamp
        ? ""
        : isExecutor
          ? `<div style="font-size:0.85em;margin-top:1mm">${stamp}</div>`
          : `<div style="font-size:0.85em;margin-top:1mm;visibility:hidden">${stamp}</div>`;
      return `<div style="flex:1;min-width:20mm">
            <div style="font-size:0.95em;font-weight:600;margin-bottom:2mm">${escapeHtmlText(label)}</div>
            ${line}
            ${name}
            ${stampHtml}
            ${
              element.dateLabel
                ? `<div style="margin-top:3mm;border-bottom:1pt solid #333;height:5mm"></div><div style="font-size:0.85em;color:#666">${escapeHtmlText(element.dateLabel)}</div>`
                : ""
            }
          </div>`;
    })
    .join("");
  return `<div style="display:flex;gap:8mm">${cells}</div>`;
}

function renderTotalsHtml(
  el: TotalsCanvasElement,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  showTokens: boolean,
): string {
  const rows = el.rows.filter((row) => row.enabled && (showTokens || canvasTotalsRowVisible(row.key, ctx)));
  if (rows.length === 0) return "";
  const moneyRows = rows.filter((row) => !isWordsTotalsKey(row.key));
  const grandKey = moneyRows[moneyRows.length - 1]?.key;
  const textColor = resolveCanvasColor(el.textColor ?? el.style.color, colors) ?? "#111111";
  const bg = resolveCanvasColor(el.background, colors);
  const blockRadius = el.style.radiusMm ?? 0;
  const grandRadius = el.grandTotalRadiusMm ?? blockRadius;
  const tableCss = `width:100%;border-collapse:separate;border-spacing:0${bg ? `;background:${bg}` : ""}${
    blockRadius ? `;overflow:hidden;border-radius:${blockRadius}mm` : ""
  }`;
  let html = `<table style="${tableCss}">`;
  for (const row of rows) {
    const isGrand = grandKey != null && row.key === grandKey;
    const rowBg = isGrand ? resolveCanvasColor(el.grandTotalBackground, colors) : undefined;
    const rowFg = isGrand ? resolveCanvasColor(el.grandTotalTextColor, colors) : textColor;
    // Drop "()" left behind when a token inside parentheses (e.g. current stage amount) resolves empty.
    const label = showTokens
      ? escapeHtmlText(row.label)
      : applyText(row.label, ctx, showCents, false).replace(/\s*\(\s*\)/g, "");
    const value = showTokens ? `«${row.key}»` : canvasTotalsValue(row.key, ctx, showCents);
    // border-radius on <tr> is ignored by browsers — round the outer corners of the cells instead,
    // and paint the background on the cells so the rounded corners are visible.
    const rounded = isGrand && grandRadius > 0;
    const cellBg = rounded && rowBg ? `background:${rowBg};` : "";
    const leftRadius = rounded ? `border-top-left-radius:${grandRadius}mm;border-bottom-left-radius:${grandRadius}mm;` : "";
    const rightRadius = rounded ? `border-top-right-radius:${grandRadius}mm;border-bottom-right-radius:${grandRadius}mm;` : "";
    html += `<tr style="${rowBg && !rounded ? `background:${rowBg};` : ""}${rowFg ? `color:${rowFg};` : ""}${isGrand ? "font-weight:700;" : ""}">`;
    html += `<td style="padding:1.5mm;text-align:right;${cellBg}${leftRadius}">${label}</td>`;
    html += `<td style="padding:1.5mm;text-align:right;font-weight:600;${cellBg}${rightRadius}">${value}</td></tr>`;
  }
  html += "</table>";
  return html;
}

/**
 * Synchronous HTML for blocks the designer draws with real data on the sheet (table, totals, signatures),
 * using exactly the same renderer as print/preview so the sketch matches the printout.
 */
export function renderCanvasBlockPreviewHtml(
  element: CanvasElement,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  showTokens: boolean,
): string | null {
  switch (element.type) {
    case "table":
      return renderTableHtml(element, ctx, colors, showCents, canvasRowsForSource(element.source, ctx), 0, true);
    case "totals":
      return renderTotalsHtml(element, ctx, colors, showCents, showTokens);
    case "signatures":
      return renderSignaturesHtml(element);
    default:
      return null;
  }
}

async function qrDataUrl(content: string): Promise<string> {
  try {
    return await QRCode.toDataURL(content || " ", { margin: 0, width: 256, errorCorrectionLevel: "M" });
  } catch {
    return "";
  }
}

function resolveQrContent(el: Extract<CanvasElement, { type: "qr" }>, ctx: PrintContext): string {
  if (el.contentToken) {
    const raw = applyTemplateVariables(el.contentToken, ctx, {
      showCents: true,
      currency: ctx.currency,
      locale: ctx.locale,
    });
    return raw.replace(/<[^>]*>/g, "").trim();
  }
  // Prefer public order URL variable when present.
  const fromVar = applyTemplateVariables("#ЗАКАЗ-ПУБЛИЧНАЯ-ССЫЛКА", ctx, {
    showCents: true,
    currency: ctx.currency,
    locale: ctx.locale,
  });
  const cleaned = fromVar.replace(/<[^>]*>/g, "").trim();
  if (cleaned) return cleaned;
  return ctx.order?.orderNumber ? `order:${ctx.order.orderNumber}` : " ";
}

/** Only real pictures: an embedded image (data:image/…) or an http(s) address. */
function safeImageSrc(raw: string | undefined): string {
  const src = (raw ?? "").trim();
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  return "";
}

function variableInnerHtml(
  element: Extract<CanvasElement, { type: "variable" }>,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  showTokens: boolean,
): string {
  const tokenText = showTokens ? escapeHtmlText(element.token) : applyText(element.token, ctx, showCents, false);
  const empty = !tokenText.replace(/<[^>]*>/g, "").trim();
  if (empty && element.hideWhenEmpty === true) return "";
  const labelColor = resolveCanvasColor(element.labelColor ?? element.style.color, colors) ?? "#666666";
  const labelWeight = element.labelBold ? "700" : "400";
  const separator = element.labelPosition === "top" ? "" : element.labelColon === false ? " " : ": ";
  const label = element.label
    ? `<span style="color:${labelColor};font-weight:${labelWeight}">${escapeHtmlText(element.label)}${separator}</span>`
    : "";
  if (element.labelPosition === "top" && label) {
    return `<div style="display:flex;flex-direction:column;gap:1mm">${label}<div>${tokenText}</div></div>`;
  }
  return `${label}${tokenText}`;
}

/**
 * Inner HTML of one element — the single source for print, preview AND the designer sheet, so the sketch
 * matches the printout. QR codes need an async encoder: here they are a placeholder (see renderElementInner).
 */
export function renderCanvasElementInnerHtml(
  element: CanvasElement,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  showTokens: boolean,
  pageIndex = 0,
  pageCount = 1,
): string {
  switch (element.type) {
    case "text":
      return applyText(element.content, ctx, showCents, showTokens);
    case "variable":
      return variableInnerHtml(element, ctx, colors, showCents, showTokens);
    case "table": {
      const rows = canvasRowsForSource(element.source, ctx);
      return renderTableHtml(element, ctx, colors, showCents, rows, 0, true);
    }
    case "totals":
      return renderTotalsHtml(element, ctx, colors, showCents, showTokens);
    case "rect":
      return "";
    case "image": {
      let src = "";
      if (element.source === "logo") {
        const logo = applyTemplateVariables("#КОМПАНИЯ-ЛОГОТИП", ctx, {
          showCents: true,
          currency: ctx.currency,
          locale: ctx.locale,
        });
        const match = /src="([^"]+)"/.exec(logo);
        src = match?.[1] ?? "";
      } else {
        src = safeImageSrc(element.url);
      }
      if (!src) return "";
      const fit = element.objectFit ?? "contain";
      return `<img src="${escapeHtmlText(src)}" alt="" style="width:100%;height:100%;object-fit:${fit};display:block" />`;
    }
    case "line": {
      const color = resolveCanvasColor(element.color, colors) ?? "#000000";
      if (element.orientation === "horizontal") {
        return `<div style="width:100%;border-top:${element.thicknessPt}pt solid ${color}"></div>`;
      }
      return `<div style="height:100%;border-left:${element.thicknessPt}pt solid ${color};width:0;margin:0 auto"></div>`;
    }
    case "signatures":
      return renderSignaturesHtml(element);
    case "qr":
      return `<div style="font-size:8pt;color:#666">QR</div>`;
    case "pageNumber": {
      const format = element.format ?? "Стр. {n} из {m}";
      const text = format.replace(/\{n\}/g, String(pageIndex + 1)).replace(/\{m\}/g, String(pageCount));
      return escapeHtmlText(text);
    }
  }
}

async function renderElementInner(
  element: CanvasElement,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  showTokens: boolean,
  pageIndex: number,
  pageCount: number,
): Promise<string> {
  if (element.type === "qr" && !showTokens) {
    const content = resolveQrContent(element, ctx);
    const dataUrl = await qrDataUrl(content);
    if (!dataUrl) return "";
    return `<img src="${dataUrl}" alt="QR" style="width:100%;height:100%;object-fit:contain" />`;
  }
  return renderCanvasElementInnerHtml(element, ctx, colors, showCents, showTokens, pageIndex, pageCount);
}

/**
 * Print-only horizontal geometry as a share of the content width (`--cx` / `--cw`). With a print-dialog scale
 * other than 100 % the sheet is wider / narrower in CSS units; the print CSS then places elements by these
 * percentages, so the design always spans the full sheet width while text and heights follow the scale
 * (and continue on the next sheet when they get taller). At 100 % the result equals the mm placement.
 */
function printWidthVars(item: { xMm: number; wMm: number }, contentWidthMm: number): string {
  const pct = (value: number) => `${Math.round((value / contentWidthMm) * 100000) / 1000}%`;
  return contentWidthMm > 0 ? `--cx:${pct(item.xMm)};--cw:${pct(item.wMm)}` : "";
}

async function renderPlaced(
  item: Placed,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  showTokens: boolean,
  pageIndex: number,
  pageCount: number,
  pageOffsetY: number,
  contentWidthMm: number,
): Promise<string> {
  const y = item.element.repeatOnEveryPage ? item.yMm : item.yMm - pageOffsetY;
  const inner = await renderElementInner(item.element, ctx, colors, showCents, showTokens, pageIndex, pageCount);

  if (item.element.type === "rect") {
    const radiusMm = item.element.radiusMm ?? item.element.style.radiusMm;
    const rectCss = rectElementCss({
      fill: item.element.fill ?? item.element.style.background,
      border: item.element.border ?? item.element.style.border,
      radiusMm,
      colors,
    });
    const parts = [
      `position:absolute`,
      `left:${item.xMm}mm`,
      `top:${y}mm`,
      `width:${item.wMm}mm`,
      `height:${item.hMm}mm`,
      `z-index:${item.element.zIndex}`,
      `-webkit-print-color-adjust:exact`,
      `print-color-adjust:exact`,
      printWidthVars(item, contentWidthMm),
      rectCss,
    ];
    return `<div data-el="${escapeHtmlText(item.element.id)}" style="${parts.join(";")}"></div>`;
  }

  // Totals grow with row count; keep visible so long "in words" lines are never clipped.
  const box = buildCanvasBoxStyle(canvasElementBoxStyle(item.element), colors, {
    // Tables and totals grow with their rows — never clip them (the designer sheet shows them whole too).
    overflow: item.element.type === "totals" || item.element.type === "table" ? "visible" : "hidden",
  });
  const wrapped = box.wrapForAlign ? canvasAlignWrapperHtml(inner, box.align) : inner;
  const parts = [
    `position:absolute`,
    `left:${item.xMm}mm`,
    `top:${y}mm`,
    `width:${item.wMm}mm`,
    `height:${item.hMm}mm`,
    `z-index:${item.element.zIndex}`,
    `-webkit-print-color-adjust:exact`,
    `print-color-adjust:exact`,
    printWidthVars(item, contentWidthMm),
    box.outerCss,
  ];
  return `<div data-el="${escapeHtmlText(item.element.id)}" style="${parts.join(";")}">${wrapped}</div>`;
}

export { canvasPageCssWithScreenPreview as canvasPageCss } from "./sheetPreview";

/**
 * Renders a canvas layout to a print-ready HTML fragment.
 * Table growth shifts overlapping elements below; overflow continues on new pages
 * with `repeatOnEveryPage` elements redrawn.
 */
export async function renderCanvasLayoutToHtml(
  layout: CanvasDocumentLayout,
  ctx: PrintContext,
  options: RenderCanvasOptions = {},
): Promise<string> {
  const showCents = options.showCents !== false;
  const showTokens = options.showTokens === true;
  const colors = options.colors ?? null;
  const { widthMm, heightMm } = pageSizeMm(layout.page.size, layout.page.orientation);
  const margins = layout.page.marginsMm;
  const contentHeightMm = heightMm - margins * 2;
  const contentWidthMm = widthMm - margins * 2;

  const placed = applyTableGrowthShifts(layout.elements, ctx, { colors, showCents, showTokens });
  const pages = paginate(placed, contentHeightMm);
  const pageCount = pages.length;
  const pageBg = fillToCss(layout.page.background, colors);

  const pageHtml: string[] = [];
  for (const page of pages) {
    const children = await Promise.all(
      page.items
        .slice()
        .sort((a, b) => a.element.zIndex - b.element.zIndex || a.yMm - b.yMm)
        .map((item) =>
          renderPlaced(item, ctx, colors, showCents, showTokens, page.pageIndex, pageCount, page.pageOffsetY, contentWidthMm),
        ),
    );
    const bgStyle = pageBg
      ? `background:${pageBg};-webkit-print-color-adjust:exact;print-color-adjust:exact;`
      : "";
    pageHtml.push(
      `<div class="canvas-page" style="position:relative;width:${contentWidthMm}mm;height:${contentHeightMm}mm;${bgStyle}page-break-after:always;overflow:hidden">${children.join("")}</div>`,
    );
  }
  if (pageHtml.length > 0) {
    pageHtml[pageHtml.length - 1] = pageHtml[pageHtml.length - 1].replace(
      "page-break-after:always",
      "page-break-after:auto",
    );
  }
  return `<div class="canvas-root" style="line-height:${CANVAS_LINE_HEIGHT};-webkit-print-color-adjust:exact;print-color-adjust:exact">${pageHtml.join("")}</div>`;
}

/**
 * Synchronous canvas render (QR shown as placeholder text).
 * Prefer `renderCanvasLayoutToHtml` for print so QR codes are real images.
 */
export function renderCanvasLayoutToHtmlSync(
  layout: CanvasDocumentLayout,
  ctx: PrintContext,
  options: RenderCanvasOptions = {},
): string {
  const showCents = options.showCents !== false;
  const showTokens = options.showTokens === true;
  const colors = options.colors ?? null;
  const { widthMm, heightMm } = pageSizeMm(layout.page.size, layout.page.orientation);
  const margins = layout.page.marginsMm;
  const contentHeightMm = heightMm - margins * 2;
  const contentWidthMm = widthMm - margins * 2;
  const placed = applyTableGrowthShifts(layout.elements, ctx, { colors, showCents, showTokens });
  const pages = paginate(placed, contentHeightMm);
  const pageBg = fillToCss(layout.page.background, colors);

  return pages
    .map((page, pageIndex) => {
      const children = page.items
        .slice()
        .sort((a, b) => a.element.zIndex - b.element.zIndex || a.yMm - b.yMm)
        .map((item) => {
          const y = item.element.repeatOnEveryPage ? item.yMm : item.yMm - page.pageOffsetY;
          const inner = renderCanvasElementInnerHtml(
            item.element,
            ctx,
            colors,
            showCents,
            showTokens,
            pageIndex,
            pages.length,
          );

          if (item.element.type === "rect") {
            const radiusMm = item.element.radiusMm ?? item.element.style.radiusMm;
            const rectCss = rectElementCss({
              fill: item.element.fill ?? item.element.style.background,
              border: item.element.border ?? item.element.style.border,
              radiusMm,
              colors,
            });
            return `<div data-el="${escapeHtmlText(item.element.id)}" style="position:absolute;left:${item.xMm}mm;top:${y}mm;width:${item.wMm}mm;height:${item.hMm}mm;z-index:${item.element.zIndex};${printWidthVars(item, contentWidthMm)};${rectCss};-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>`;
          }
          const box = buildCanvasBoxStyle(canvasElementBoxStyle(item.element), colors, {
            // Tables and totals grow with their rows — never clip them (the designer sheet shows them whole too).
    overflow: item.element.type === "totals" || item.element.type === "table" ? "visible" : "hidden",
          });
          const wrapped = box.wrapForAlign ? canvasAlignWrapperHtml(inner, box.align) : inner;
          return `<div data-el="${escapeHtmlText(item.element.id)}" style="position:absolute;left:${item.xMm}mm;top:${y}mm;width:${item.wMm}mm;height:${item.hMm}mm;z-index:${item.element.zIndex};${printWidthVars(item, contentWidthMm)};${box.outerCss};-webkit-print-color-adjust:exact;print-color-adjust:exact">${wrapped}</div>`;
        })
        .join("");
      const bgStyle = pageBg ? `background:${pageBg};` : "";
      const breakAfter = pageIndex < pages.length - 1 ? "page-break-after:always;" : "";
      return `<div class="canvas-page" style="position:relative;width:${contentWidthMm}mm;height:${contentHeightMm}mm;line-height:${CANVAS_LINE_HEIGHT};${bgStyle}${breakAfter}-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow:hidden">${children}</div>`;
    })
    .join("");
}
