/** Print-accurate HTML renderer for canvas (v3) layouts. Coordinates in mm; print-color-adjust: exact. */

import QRCode from "qrcode";
import type { StyleColorPalette } from "../colorRef";
import { formatQuantity } from "../../../lib/quantity";
import { vatIncludedAmount } from "../../finance/vat";
import { applyTemplateVariables } from "../printTemplate";
import { escapeHtmlText, printContextVatBreakdown, type PrintContext } from "../templateVariables";
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
  type CanvasElementStyle,
  type TableCanvasElement,
  type TotalsCanvasElement,
} from "./types";

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

function overlapsX(a: Placed, b: { xMm: number; wMm: number }): boolean {
  return a.xMm < b.xMm + b.wMm && a.xMm + a.wMm > b.xMm;
}

function shiftOverlappingBelow(placed: Placed[], grown: Placed, extra: number) {
  if (extra <= 0) return;
  const originalBottom = grown.yMm + (grown.hMm - extra);
  for (const other of placed) {
    if (other === grown) continue;
    if (other.yMm >= originalBottom - 0.01 && overlapsX(other, grown)) {
      other.yMm += extra;
    }
  }
}

/** Grow tables/totals to fit content; shift overlapping elements below. */
export function applyTableGrowthShifts(elements: CanvasElement[], ctx: PrintContext): Placed[] {
  const placed: Placed[] = elements.map((element) => ({
    element,
    xMm: element.xMm,
    yMm: element.yMm,
    wMm: element.wMm,
    hMm: element.hMm,
  }));

  const growable = placed
    .filter((item) => item.element.type === "table" || item.element.type === "totals")
    .sort((a, b) => a.yMm - b.yMm);

  for (const item of growable) {
    if (item.element.type === "table") {
      const el = item.element as TableCanvasElement;
      const rows = canvasRowsForSource(el.source, ctx);
      const grown = estimateTableHeightMm(rows.length, el.showTotalsRow, item.hMm);
      const extra = grown - item.hMm;
      item.hMm = grown;
      shiftOverlappingBelow(placed, item, extra);
      continue;
    }
    if (item.element.type === "totals") {
      const el = item.element as TotalsCanvasElement;
      const visibleRows = el.rows.filter((row) => row.enabled && canvasTotalsRowVisible(row.key, ctx));
      const grown = estimateTotalsHeightMm(visibleRows.length, item.hMm, visibleRows);
      const extra = grown - item.hMm;
      item.hMm = grown;
      shiftOverlappingBelow(placed, item, extra);
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

function styleFontCss(style: CanvasElementStyle, colors: StyleColorPalette | null | undefined): string {
  const parts: string[] = [
    `font-size:${style.fontSizePt}pt`,
    `text-align:${style.align}`,
    `padding:${style.paddingMm}mm`,
    `box-sizing:border-box`,
    `overflow:hidden`,
  ];
  const color = resolveCanvasColor(style.color, colors);
  if (color) parts.push(`color:${color}`);
  if (style.bold) parts.push("font-weight:700");
  if (style.italic) parts.push("font-style:italic");
  if (style.underline) parts.push("text-decoration:underline");
  if (style.fontFamily) parts.push(`font-family:${escapeHtmlText(style.fontFamily)}`);
  if (style.lineHeight) parts.push(`line-height:${style.lineHeight}`);
  if (style.verticalAlign === "middle") parts.push("display:flex;align-items:center");
  else if (style.verticalAlign === "bottom") parts.push("display:flex;align-items:flex-end");
  const bg = fillToCss(style.background, colors);
  if (bg) parts.push(`background:${bg}`);
  if (style.radiusMm) parts.push(`border-radius:${style.radiusMm}mm`);
  if (style.border) {
    const borderColor = resolveCanvasColor(style.border.color, colors) ?? "#000000";
    const width = `${style.border.widthPt}pt`;
    const bstyle = style.border.style;
    const sides = style.border.sides?.length
      ? style.border.sides
      : (["top", "right", "bottom", "left"] as const);
    for (const side of sides) {
      parts.push(`border-${side}:${width} ${bstyle} ${borderColor}`);
    }
  }
  return parts.join(";");
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

  let html = `<table style="width:100%;border-collapse:collapse;height:100%">`;
  if (includeHeader) {
    html += "<thead><tr>";
    for (const column of columns) {
      const width = column.widthPercent ? `width:${column.widthPercent}%` : "";
      const align = column.align ?? "left";
      html += `<th style="${cellBorder};padding:2mm 1.5mm;text-align:${align};background:${headerBg};color:${headerFg};${width}">${escapeHtmlText(column.label)}</th>`;
    }
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
        (column.key === "name" || column.key === "sku" || column.key === "warranty" || column.key === "performer"
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
      return `<div style="flex:1;min-width:20mm">
            <div style="font-size:0.95em;font-weight:600;margin-bottom:2mm">${escapeHtmlText(label)}</div>
            <div style="border-bottom:1pt solid #333;height:10mm;margin-bottom:1mm"></div>
            <div style="font-size:0.85em;color:#444">${nameLine}</div>
            ${isExecutor ? `<div style="font-size:0.85em;margin-top:1mm">${stamp}</div>` : `<div style="font-size:0.85em;margin-top:1mm;visibility:hidden">${stamp}</div>`}
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
  let html = `<table style="width:100%;border-collapse:collapse${bg ? `;background:${bg}` : ""}">`;
  for (const row of rows) {
    const isGrand = grandKey != null && row.key === grandKey;
    const rowBg = isGrand ? resolveCanvasColor(el.grandTotalBackground, colors) : undefined;
    const rowFg = isGrand ? resolveCanvasColor(el.grandTotalTextColor, colors) : textColor;
    // Drop "()" left behind when a token inside parentheses (e.g. current stage amount) resolves empty.
    const label = showTokens
      ? escapeHtmlText(row.label)
      : applyText(row.label, ctx, showCents, false).replace(/\s*\(\s*\)/g, "");
    const value = showTokens ? `«${row.key}»` : canvasTotalsValue(row.key, ctx, showCents);
    html += `<tr style="${rowBg ? `background:${rowBg};` : ""}${rowFg ? `color:${rowFg};` : ""}${isGrand ? "font-weight:700;" : ""}">`;
    html += `<td style="padding:1.5mm;text-align:right">${label}</td>`;
    html += `<td style="padding:1.5mm;text-align:right;font-weight:600">${value}</td></tr>`;
  }
  html += "</table>";
  return html;
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

async function renderElementInner(
  element: CanvasElement,
  ctx: PrintContext,
  colors: StyleColorPalette | null | undefined,
  showCents: boolean,
  showTokens: boolean,
  pageIndex: number,
  pageCount: number,
): Promise<string> {
  switch (element.type) {
    case "text":
      return applyText(element.content, ctx, showCents, showTokens);
    case "variable": {
      const tokenText = showTokens ? escapeHtmlText(element.token) : applyText(element.token, ctx, showCents, false);
      const empty = !tokenText.replace(/<[^>]*>/g, "").trim();
      if (empty && element.hideIfEmpty !== false) return "";
      const labelColor = resolveCanvasColor(element.labelColor ?? element.style.color, colors) ?? "#666666";
      const labelWeight = element.labelBold ? "700" : "400";
      const label = element.label
        ? `<span style="color:${labelColor};font-weight:${labelWeight}">${escapeHtmlText(element.label)}${element.labelPosition === "top" ? "" : ": "}</span>`
        : "";
      if (element.labelPosition === "top" && label) {
        return `<div style="display:flex;flex-direction:column;gap:1mm">${label}<div>${tokenText}</div></div>`;
      }
      return `${label}${tokenText}`;
    }
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
        src = element.url?.trim() ?? "";
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
    case "qr": {
      if (showTokens) return `<div style="font-size:8pt;color:#666">QR</div>`;
      const content = resolveQrContent(element, ctx);
      const dataUrl = await qrDataUrl(content);
      if (!dataUrl) return "";
      return `<img src="${dataUrl}" alt="QR" style="width:100%;height:100%;object-fit:contain" />`;
    }
    case "pageNumber": {
      const format = element.format ?? "Стр. {n} из {m}";
      const text = format.replace(/\{n\}/g, String(pageIndex + 1)).replace(/\{m\}/g, String(pageCount));
      return escapeHtmlText(text);
    }
  }
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
): Promise<string> {
  const y = item.element.repeatOnEveryPage ? item.yMm : item.yMm - pageOffsetY;
  const inner = await renderElementInner(item.element, ctx, colors, showCents, showTokens, pageIndex, pageCount);
  const styleCss = styleFontCss(item.element.style, colors);

  if (item.element.type === "rect") {
    const fill = fillToCss(item.element.fill ?? item.element.style.background, colors);
    const border = item.element.border ?? item.element.style.border;
    const parts = [
      `position:absolute`,
      `left:${item.xMm}mm`,
      `top:${y}mm`,
      `width:${item.wMm}mm`,
      `height:${item.hMm}mm`,
      `z-index:${item.element.zIndex}`,
      `box-sizing:border-box`,
      `-webkit-print-color-adjust:exact`,
      `print-color-adjust:exact`,
    ];
    if (fill) parts.push(`background:${fill}`);
    if (item.element.radiusMm ?? item.element.style.radiusMm) {
      parts.push(`border-radius:${item.element.radiusMm ?? item.element.style.radiusMm}mm`);
    }
    if (border) {
      const borderColor = resolveCanvasColor(border.color, colors) ?? "#000000";
      parts.push(`border:${border.widthPt}pt ${border.style} ${borderColor}`);
    }
    return `<div data-el="${escapeHtmlText(item.element.id)}" style="${parts.join(";")}"></div>`;
  }

  const parts = [
    `position:absolute`,
    `left:${item.xMm}mm`,
    `top:${y}mm`,
    `width:${item.wMm}mm`,
    `height:${item.hMm}mm`,
    `z-index:${item.element.zIndex}`,
    `-webkit-print-color-adjust:exact`,
    `print-color-adjust:exact`,
    styleCss,
  ];
  // Totals grow with row count; keep visible so long "in words" lines are never clipped.
  if (item.element.type === "totals") parts.push("overflow:visible");
  return `<div data-el="${escapeHtmlText(item.element.id)}" style="${parts.join(";")}">${inner}</div>`;
}

export function canvasPageCss(layout: CanvasDocumentLayout, fontFamilyCss?: string): string {
  const size = layout.page.size === "A5" ? "A5" : "A4";
  const font = fontFamilyCss ? `font-family:${fontFamilyCss};` : "";
  return `@page{size:${size} ${layout.page.orientation};margin:${layout.page.marginsMm}mm}body{${font}margin:0;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
}

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

  const placed = applyTableGrowthShifts(layout.elements, ctx);
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
          renderPlaced(item, ctx, colors, showCents, showTokens, page.pageIndex, pageCount, page.pageOffsetY),
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
  return `<div class="canvas-root" style="-webkit-print-color-adjust:exact;print-color-adjust:exact">${pageHtml.join("")}</div>`;
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
  const placed = applyTableGrowthShifts(layout.elements, ctx);
  const pages = paginate(placed, contentHeightMm);
  const pageBg = fillToCss(layout.page.background, colors);

  return pages
    .map((page, pageIndex) => {
      const children = page.items
        .slice()
        .sort((a, b) => a.element.zIndex - b.element.zIndex || a.yMm - b.yMm)
        .map((item) => {
          const y = item.element.repeatOnEveryPage ? item.yMm : item.yMm - page.pageOffsetY;
          let inner = "";
          if (item.element.type === "text") inner = applyText(item.element.content, ctx, showCents, showTokens);
          else if (item.element.type === "variable") {
            const tokenText = showTokens
              ? escapeHtmlText(item.element.token)
              : applyText(item.element.token, ctx, showCents, false);
            const label = item.element.label
              ? `<span>${escapeHtmlText(item.element.label)}: </span>`
              : "";
            inner = `${label}${tokenText}`;
          } else if (item.element.type === "table") {
            const rows = canvasRowsForSource(item.element.source, ctx);
            inner = renderTableHtml(item.element, ctx, colors, showCents, rows, 0, true);
          } else if (item.element.type === "totals") {
            inner = renderTotalsHtml(item.element, ctx, colors, showCents, showTokens);
          } else if (item.element.type === "pageNumber") {
            const format = item.element.format ?? "Стр. {n} из {m}";
            inner = escapeHtmlText(
              format.replace(/\{n\}/g, String(pageIndex + 1)).replace(/\{m\}/g, String(pages.length)),
            );
          } else if (item.element.type === "signatures") {
            inner = renderSignaturesHtml(item.element);
          } else if (item.element.type === "qr") {
            inner = "QR";
          } else if (item.element.type === "line") {
            const color = resolveCanvasColor(item.element.color, colors) ?? "#000";
            inner =
              item.element.orientation === "horizontal"
                ? `<div style="border-top:${item.element.thicknessPt}pt solid ${color}"></div>`
                : `<div style="border-left:${item.element.thicknessPt}pt solid ${color};height:100%"></div>`;
          }

          if (item.element.type === "rect") {
            const fill = fillToCss(item.element.fill ?? item.element.style.background, colors);
            return `<div data-el="${escapeHtmlText(item.element.id)}" style="position:absolute;left:${item.xMm}mm;top:${y}mm;width:${item.wMm}mm;height:${item.hMm}mm;z-index:${item.element.zIndex};${fill ? `background:${fill};` : ""}-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>`;
          }
          const overflow = item.element.type === "totals" ? "overflow:visible;" : "";
          return `<div data-el="${escapeHtmlText(item.element.id)}" style="position:absolute;left:${item.xMm}mm;top:${y}mm;width:${item.wMm}mm;height:${item.hMm}mm;z-index:${item.element.zIndex};${styleFontCss(item.element.style, colors)};${overflow}-webkit-print-color-adjust:exact;print-color-adjust:exact">${inner}</div>`;
        })
        .join("");
      const bgStyle = pageBg ? `background:${pageBg};` : "";
      const breakAfter = pageIndex < pages.length - 1 ? "page-break-after:always;" : "";
      return `<div class="canvas-page" style="position:relative;width:${contentWidthMm}mm;height:${contentHeightMm}mm;${bgStyle}${breakAfter}-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow:hidden">${children}</div>`;
    })
    .join("");
}
