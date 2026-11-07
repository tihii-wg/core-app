/** Versioned print-document layout model + HTML renderer for the visual builder. */

import type { InvoiceDocument, InvoiceItem, Order, OrderMaterial, OrderService } from "../../lib/types";
import i18n, { currentLanguage } from "../../i18n";
import { isAppLanguage } from "../../i18n/languages";
import { formatWorkspaceDate } from "../../lib/workspaceFormat";
import { vatIncludedAmount } from "../finance/vat";
import type { InvoiceSections } from "../invoices/invoiceItemSections";
import { lineTotal } from "../invoices/invoiceItemSections";
import { lineNet } from "../orders/orderTotals";
import { amountInWords, normalizeAmountInWordsLocale } from "./amountInWords";
import {
  isColorRef,
  resolveColorRef,
  type ColorRef,
  type StyleColorPalette,
} from "./colorRef";
import { isSafeHexColor } from "./layoutHex";
import { applyTemplateVariables } from "./printTemplate";
import {
  escapeHtmlText,
  printContextVatBreakdown,
  TEMPLATE_VARIABLES,
  type PrintContext,
} from "./templateVariables";

export { isSafeHexColor } from "./layoutHex";
export type { ColorRef } from "./colorRef";

export type PageSize = "A4" | "A5";
export type PageOrientation = "portrait" | "landscape";

export type DocumentLayoutPage = {
  size: PageSize;
  orientation: PageOrientation;
  marginsMm: number;
  fontSizePt: number;
};

/** Block chrome — hex or theme:* ColorRef (resolved at render when a style palette is provided). */
export type BlockStyle = {
  background?: ColorRef;
  color?: ColorRef;
  titleColor?: ColorRef;
  border?: "none" | "box";
  padding?: "none" | "sm" | "md";
  align?: "left" | "center" | "right";
  fontScale?: number;
};

/**
 * Field row. Prefer `template` (tokens + text). Legacy `{ token }` still works.
 * `label` may itself contain tokens. Empty values hide the row when `hideIfEmpty` (default true).
 */
export type FieldRef = {
  label: string;
  enabled: boolean;
  hideIfEmpty?: boolean;
  template?: string;
  /** @deprecated Prefer `template`. Kept for v1 layouts. */
  token?: string;
};

export type TableColumnKey =
  | "index"
  | "name"
  | "sku"
  | "qty"
  | "unit"
  | "price"
  | "discount"
  | "vat"
  | "sum"
  | "warranty"
  | "performer";
export type TableColumn = { key: TableColumnKey; label: string; enabled: boolean; widthPercent?: number };
export type TableSource =
  | "services"
  | "materials"
  | "allLines"
  | "invoiceLines"
  | "invoiceWorks"
  | "invoiceMaterials";
export type TotalsRowKey =
  | "servicesSum"
  | "materialsSum"
  | "discount"
  | "net"
  | "vat"
  | "grossWithVat"
  | "total"
  | "paid"
  | "remaining"
  | "totalWords";
export type TotalsRow = { key: TotalsRowKey; label: string; enabled: boolean };

export type LayoutBlockBase = { id: string; kind: string; enabled: boolean; title?: string; style?: BlockStyle };

export type CompanyHeaderBlock = LayoutBlockBase & {
  kind: "companyHeader";
  fields: FieldRef[];
  align: "left" | "center" | "right";
};
export type DocumentTitleBlock = LayoutBlockBase & { kind: "documentTitle"; text: string };
export type FieldsBlock = LayoutBlockBase & { kind: "fields"; fields: FieldRef[] };
export type TableBlock = LayoutBlockBase & {
  kind: "table";
  source: TableSource;
  columns: TableColumn[];
  showTotalsRow: boolean;
};
export type TotalsBlock = LayoutBlockBase & { kind: "totals"; rows: TotalsRow[] };
export type WarrantyBlock = LayoutBlockBase & { kind: "warranty" };
export type TextBlock = LayoutBlockBase & { kind: "text"; html: string };
export type SignaturesBlock = LayoutBlockBase & { kind: "signatures"; labels: string[]; dateLabel?: string };
export type SpacerBlock = LayoutBlockBase & { kind: "spacer"; heightMm?: number };
export type DividerBlock = LayoutBlockBase & { kind: "divider" };
/** Renders DocumentStyle.sharedHeader at this position. */
export type StyleHeaderBlock = LayoutBlockBase & { kind: "styleHeader" };
/** Renders DocumentStyle.sharedFooter at this position. */
export type StyleFooterBlock = LayoutBlockBase & { kind: "styleFooter" };

export type LayoutColumn = { id: string; widthPercent: number; blocks: LayoutBlock[] };
export type ColumnsBlock = LayoutBlockBase & {
  kind: "columns";
  columns: LayoutColumn[];
  gapMm?: number;
};

/** Leaf blocks (anything except nested columns). */
export type LeafLayoutBlock =
  | CompanyHeaderBlock
  | DocumentTitleBlock
  | FieldsBlock
  | TableBlock
  | TotalsBlock
  | WarrantyBlock
  | TextBlock
  | SignaturesBlock
  | SpacerBlock
  | DividerBlock
  | StyleHeaderBlock
  | StyleFooterBlock;

export type LayoutBlock = LeafLayoutBlock | ColumnsBlock;

export type DocumentLayout = {
  version: 1 | 2;
  page: DocumentLayoutPage;
  blocks: LayoutBlock[];
  /**
   * When true, page/font/title/table chrome come from the workspace DocumentStyle
   * (unless the document overrides page explicitly via its own page object — page is always present,
   * but effective page/font are merged from style at render).
   * Absent / false keeps legacy rendering (existing templates).
   */
  useStyle?: boolean;
};

export type DocumentTemplateType = "work_order" | "act" | "invoice";

/** Optional shared style applied while rendering a layout. */
export type LayoutRenderStyle = {
  colors: StyleColorPalette;
  title: {
    align: "left" | "center" | "right";
    sizePt: number;
    color: ColorRef;
    uppercase: boolean;
  };
  table: {
    headerBackground: ColorRef;
    headerColor: ColorRef;
    borders: "all" | "horizontal" | "none";
    zebra: boolean;
  };
  sharedHeader: LayoutBlock[];
  sharedFooter: LayoutBlock[];
  /** CSS font-family stack when useStyle is on. */
  fontFamilyCss?: string;
};

const LEAF_KINDS = new Set([
  "companyHeader",
  "documentTitle",
  "fields",
  "table",
  "totals",
  "warranty",
  "text",
  "signatures",
  "spacer",
  "divider",
  "styleHeader",
  "styleFooter",
]);
const TABLE_KEYS = new Set<TableColumnKey>([
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
const TOTAL_KEYS = new Set<TotalsRowKey>([
  "servicesSum",
  "materialsSum",
  "discount",
  "net",
  "vat",
  "grossWithVat",
  "total",
  "paid",
  "remaining",
  "totalWords",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStyle(value: unknown): BlockStyle | undefined {
  if (!isRecord(value)) return undefined;
  const style: BlockStyle = {};
  if (typeof value.background === "string" && isColorRef(value.background)) style.background = value.background.trim();
  if (typeof value.color === "string" && isColorRef(value.color)) style.color = value.color.trim();
  if (typeof value.titleColor === "string" && isColorRef(value.titleColor)) style.titleColor = value.titleColor.trim();
  if (value.border === "none" || value.border === "box") style.border = value.border;
  if (value.padding === "none" || value.padding === "sm" || value.padding === "md") style.padding = value.padding;
  if (value.align === "left" || value.align === "center" || value.align === "right") style.align = value.align;
  if (typeof value.fontScale === "number" && Number.isFinite(value.fontScale) && value.fontScale > 0 && value.fontScale <= 3) {
    style.fontScale = value.fontScale;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function isFieldRef(value: unknown): value is FieldRef {
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.enabled !== "boolean") return false;
  const hasTemplate = typeof value.template === "string";
  const hasToken = typeof value.token === "string";
  if (!hasTemplate && !hasToken) return false;
  if (value.hideIfEmpty != null && typeof value.hideIfEmpty !== "boolean") return false;
  return true;
}

function isTableColumn(value: unknown): value is TableColumn {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    TABLE_KEYS.has(value.key as TableColumnKey) &&
    typeof value.label === "string" &&
    typeof value.enabled === "boolean"
  );
}

function isTotalsRow(value: unknown): value is TotalsRow {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    TOTAL_KEYS.has(value.key as TotalsRowKey) &&
    typeof value.label === "string" &&
    typeof value.enabled === "boolean"
  );
}

function parseLeafBlock(value: unknown): LeafLayoutBlock | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string" || !LEAF_KINDS.has(value.kind)) {
    return null;
  }
  const enabled = value.enabled !== false;
  const title = typeof value.title === "string" ? value.title : undefined;
  const style = parseStyle(value.style);
  const base = { id: value.id, enabled, title, style };

  switch (value.kind) {
    case "companyHeader": {
      if (!Array.isArray(value.fields) || !value.fields.every(isFieldRef)) return null;
      const align = value.align === "center" || value.align === "right" ? value.align : "left";
      return { ...base, kind: "companyHeader", fields: value.fields, align };
    }
    case "documentTitle":
      return { ...base, kind: "documentTitle", text: typeof value.text === "string" ? value.text : "" };
    case "fields":
      if (!Array.isArray(value.fields) || !value.fields.every(isFieldRef)) return null;
      return { ...base, kind: "fields", fields: value.fields };
    case "table": {
      if (!Array.isArray(value.columns) || !value.columns.every(isTableColumn)) return null;
      const source =
        value.source === "materials" ||
        value.source === "allLines" ||
        value.source === "invoiceLines" ||
        value.source === "invoiceWorks" ||
        value.source === "invoiceMaterials"
          ? value.source
          : "services";
      return { ...base, kind: "table", source, columns: value.columns, showTotalsRow: value.showTotalsRow !== false };
    }
    case "totals":
      if (!Array.isArray(value.rows) || !value.rows.every(isTotalsRow)) return null;
      return { ...base, kind: "totals", rows: value.rows };
    case "warranty":
      return { ...base, kind: "warranty" };
    case "text":
      return { ...base, kind: "text", html: typeof value.html === "string" ? value.html : "" };
    case "signatures":
      if (!Array.isArray(value.labels) || !value.labels.every((item) => typeof item === "string")) return null;
      return {
        ...base,
        kind: "signatures",
        labels: value.labels,
        dateLabel: typeof value.dateLabel === "string" ? value.dateLabel : undefined,
      };
    case "spacer":
      return {
        ...base,
        kind: "spacer",
        heightMm: typeof value.heightMm === "number" && Number.isFinite(value.heightMm) ? value.heightMm : 8,
      };
    case "divider":
      return { ...base, kind: "divider" };
    case "styleHeader":
      return { ...base, kind: "styleHeader" };
    case "styleFooter":
      return { ...base, kind: "styleFooter" };
    default:
      return null;
  }
}

function parseColumn(value: unknown): LayoutColumn | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  if (typeof value.widthPercent !== "number" || !Number.isFinite(value.widthPercent)) return null;
  if (!Array.isArray(value.blocks)) return null;
  const blocks: LayoutBlock[] = [];
  for (const child of value.blocks) {
    // Nested columns are not allowed.
    if (isRecord(child) && child.kind === "columns") return null;
    const parsed = parseLeafBlock(child);
    if (!parsed) return null;
    blocks.push(parsed);
  }
  return { id: value.id, widthPercent: value.widthPercent, blocks };
}

function parseBlock(value: unknown, allowColumns: boolean): LayoutBlock | null {
  if (isRecord(value) && value.kind === "columns") {
    if (!allowColumns) return null;
    if (typeof value.id !== "string") return null;
    // 2–4 columns (invoice info grid uses 4; builder offers 2 or 3 by default).
    if (!Array.isArray(value.columns) || value.columns.length < 2 || value.columns.length > 4) return null;
    const columns = value.columns.map(parseColumn);
    if (columns.some((column) => column == null)) return null;
    const typed = columns as LayoutColumn[];
    const sum = typed.reduce((acc, column) => acc + column.widthPercent, 0);
    if (Math.abs(sum - 100) > 0.5) return null;
    return {
      id: value.id,
      kind: "columns",
      enabled: value.enabled !== false,
      title: typeof value.title === "string" ? value.title : undefined,
      style: parseStyle(value.style),
      columns: typed,
      gapMm: typeof value.gapMm === "number" && Number.isFinite(value.gapMm) ? value.gapMm : 3,
    };
  }
  return parseLeafBlock(value);
}

function isPage(page: unknown): page is DocumentLayoutPage {
  if (!isRecord(page)) return false;
  if (page.size !== "A4" && page.size !== "A5") return false;
  if (page.orientation !== "portrait" && page.orientation !== "landscape") return false;
  if (typeof page.marginsMm !== "number" || !Number.isFinite(page.marginsMm)) return false;
  if (typeof page.fontSizePt !== "number" || !Number.isFinite(page.fontSizePt)) return false;
  return true;
}

/** Type guard for persisted layout JSON (v1 or v2). Rejects nested columns and unsafe styles. */
export function isDocumentLayout(value: unknown): value is DocumentLayout {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !isPage(value.page) || !Array.isArray(value.blocks)) {
    return false;
  }
  if (value.useStyle != null && typeof value.useStyle !== "boolean") return false;
  return value.blocks.every((block) => parseBlock(block, true) != null);
}

/** Migrates a valid v1 layout to v2 (same blocks; version bumped). Preserves useStyle when set. */
export function migrateLayoutToV2(layout: DocumentLayout): DocumentLayout {
  if (layout.version === 2) return layout;
  return {
    version: 2,
    page: layout.page,
    blocks: layout.blocks,
    ...(layout.useStyle != null ? { useStyle: layout.useStyle } : {}),
  };
}

export function parseDocumentLayout(value: unknown): DocumentLayout | null {
  if (!isDocumentLayout(value)) return null;
  const blocks = value.blocks.map((block) => parseBlock(block, true)).filter((block): block is LayoutBlock => block != null);
  return migrateLayoutToV2({
    version: value.version,
    page: value.page,
    blocks,
    ...(value.useStyle != null ? { useStyle: value.useStyle } : {}),
  });
}

function resolveTokenRaw(token: string, ctx: PrintContext): string | number | null {
  const variable = TEMPLATE_VARIABLES.find((item) => item.token === token);
  if (!variable) return null;
  try {
    return variable.resolve(ctx);
  } catch {
    return null;
  }
}

function formatToken(token: string, ctx: PrintContext, showCents: boolean): string {
  const variable = TEMPLATE_VARIABLES.find((item) => item.token === token);
  if (!variable) return "";
  const raw = resolveTokenRaw(token, ctx);
  if (raw == null) return "";
  if (variable.kind === "html") return String(raw);
  if (variable.kind === "money") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return "";
    const digits = showCents ? 2 : 0;
    const amount = n.toLocaleString(ctx.locale || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return escapeHtmlText(ctx.currency ? `${ctx.currency} ${amount}` : amount);
  }
  if (variable.kind === "date" || variable.kind === "datetime") {
    return escapeHtmlText(formatWorkspaceDate(String(raw), ctx.dateFormat, ctx.timeZone));
  }
  return escapeHtmlText(String(raw));
}

function applyTemplateText(text: string, ctx: PrintContext, showCents: boolean): string {
  return applyTemplateVariables(text, ctx, { showCents, currency: ctx.currency, locale: ctx.locale });
}

/** Whether a template string resolves to a non-empty visible value (ignoring whitespace / empty token results). */
function templateHasValue(template: string, ctx: PrintContext, showCents: boolean): boolean {
  const TOKEN = /#[A-ZА-ЯЁ0-9-]+/giu;
  const tokens = template.match(TOKEN) ?? [];
  if (tokens.length === 0) return template.trim().length > 0;
  return tokens.some((token) => {
    const formatted = formatToken(token, ctx, showCents);
    return formatted.replace(/<[^>]*>/g, "").trim().length > 0;
  });
}

function money(n: number, ctx: PrintContext, showCents: boolean) {
  const digits = showCents ? 2 : 0;
  const amount = n.toLocaleString(ctx.locale || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return escapeHtmlText(ctx.currency ? `${ctx.currency} ${amount}` : amount);
}

type RenderEnv = {
  showCents: boolean;
  style: LayoutRenderStyle | null;
  /** Prevents infinite expansion of styleHeader/styleFooter. */
  expandingShared: boolean;
};

function resolveStyleColor(ref: ColorRef | undefined, env: RenderEnv): string | undefined {
  if (!ref) return undefined;
  if (env.style) return resolveColorRef(ref, env.style.colors);
  return isSafeHexColor(ref) ? ref.trim() : undefined;
}

function styleToCss(style: BlockStyle | undefined, env: RenderEnv, title = false): string {
  if (!style) return "";
  const parts: string[] = [];
  const background = resolveStyleColor(style.background, env);
  if (background) parts.push(`background:${background}`);
  if (title) {
    const titleColor = resolveStyleColor(style.titleColor, env);
    if (titleColor) parts.push(`color:${titleColor}`);
  } else {
    const color = resolveStyleColor(style.color, env);
    if (color) parts.push(`color:${color}`);
  }
  const borderColor = env.style ? resolveColorRef(env.style.colors.border, env.style.colors) : "#e5e7eb";
  if (style.border === "box") parts.push(`border:1px solid ${borderColor ?? "#e5e7eb"};border-radius:6px`);
  if (style.padding === "sm") parts.push("padding:6px 10px");
  else if (style.padding === "md") parts.push("padding:10px 14px");
  if (style.align) parts.push(`text-align:${style.align}`);
  if (style.fontScale && style.fontScale !== 1) parts.push(`font-size:${style.fontScale}em`);
  return parts.join(";");
}

function wrapStyled(inner: string, style: BlockStyle | undefined, env: RenderEnv, extra = ""): string {
  if (!inner) return "";
  const css = [styleToCss(style, env), extra].filter(Boolean).join(";");
  if (!css) return inner;
  return `<div style="${css}">${inner}</div>`;
}

function titledBlock(
  title: string | undefined,
  style: BlockStyle | undefined,
  body: string,
  ctx: PrintContext,
  env: RenderEnv,
) {
  if (!body && !title) return "";
  const titleHtml = title
    ? `<h3 style="margin:0 0 6px;font-size:1.05em;${styleToCss({ ...style, color: undefined }, env, true)}">${applyTemplateText(title, ctx, env.showCents)}</h3>`
    : "";
  return wrapStyled(`${titleHtml}${body}`, style, env, "margin:8px 0");
}

type LineRow = {
  name: string;
  sku: string;
  qty: number;
  unit: string;
  price: number;
  discount: string;
  sum: number;
  warranty: string;
  performer: string;
};

function serviceRows(order: Order | null): LineRow[] {
  return (order?.services ?? []).map((line: OrderService) => ({
    name: line.serviceName,
    sku: "",
    qty: line.quantity,
    unit: "",
    price: line.price,
    discount:
      line.discountType === "percent" && line.discountValue
        ? `${line.discountValue}%`
        : line.discountType === "amount" && line.discountValue
          ? String(line.discountValue)
          : "",
    sum: lineNet(line.price, line.quantity, line.discountType, line.discountValue),
    warranty: line.warrantyMonths ? `${line.warrantyMonths} mo` : "",
    performer: line.technicianName?.trim() || "",
  }));
}

function materialRows(order: Order | null): LineRow[] {
  return (order?.materials ?? []).map((line: OrderMaterial) => ({
    name: line.itemName,
    sku: "",
    qty: line.quantity,
    unit: "",
    price: line.price,
    discount:
      line.discountType === "percent" && line.discountValue
        ? `${line.discountValue}%`
        : line.discountType === "amount" && line.discountValue
          ? String(line.discountValue)
          : "",
    sum: lineNet(line.price, line.quantity, line.discountType, line.discountValue),
    warranty: line.warrantyMonths ? `${line.warrantyMonths} mo` : "",
    performer: "",
  }));
}

function invoiceItemRows(items: InvoiceItem[]): LineRow[] {
  return items.map((item) => ({
    name: item.serviceName,
    sku: "",
    qty: item.quantity,
    unit: "",
    price: item.price,
    discount: "",
    sum: lineTotal(item),
    warranty: "",
    performer: "",
  }));
}

function invoiceRows(invoice: InvoiceDocument | null): LineRow[] {
  return invoiceItemRows(invoice?.items ?? []);
}

function sectionsOf(ctx: PrintContext): InvoiceSections | null {
  return ctx.invoiceSections;
}

function rowsForSource(source: TableSource, ctx: PrintContext): LineRow[] {
  if (source === "services") return serviceRows(ctx.order);
  if (source === "materials") return materialRows(ctx.order);
  if (source === "invoiceLines") return invoiceRows(ctx.invoice);
  if (source === "invoiceWorks") return invoiceItemRows(sectionsOf(ctx)?.works ?? []);
  if (source === "invoiceMaterials") return invoiceItemRows(sectionsOf(ctx)?.materials ?? []);
  return [...serviceRows(ctx.order), ...materialRows(ctx.order)];
}

function tableCellBorder(env: RenderEnv): string {
  if (!env.style) return "border:1px solid #ccc";
  const borders = env.style.table.borders;
  const color = resolveColorRef(env.style.colors.border, env.style.colors) ?? "#ccc";
  if (borders === "none") return "border:none";
  if (borders === "horizontal") return `border:none;border-bottom:1px solid ${color}`;
  return `border:1px solid ${color}`;
}

function renderTable(block: TableBlock, ctx: PrintContext, env: RenderEnv) {
  const columns = block.columns.filter((column) => column.enabled);
  if (columns.length === 0) return "";
  const rows = rowsForSource(block.source, ctx);
  if (rows.length === 0) return "";
  const cellBorder = tableCellBorder(env);
  const headerBg = env.style ? resolveColorRef(env.style.table.headerBackground, env.style.colors) : undefined;
  const headerFg = env.style ? resolveColorRef(env.style.table.headerColor, env.style.colors) : undefined;
  const zebra = env.style?.table.zebra === true;
  const zebraBg = env.style ? resolveColorRef(env.style.colors.tint, env.style.colors) : undefined;
  let html = `<table style="width:100%;border-collapse:collapse;margin:4px 0"><thead><tr>`;
  for (const column of columns) {
    const width = column.widthPercent ? `width:${column.widthPercent}%` : "";
    const headStyle = [
      cellBorder,
      "padding:4px 6px",
      "text-align:left",
      width,
      headerBg ? `background:${headerBg}` : "",
      headerFg ? `color:${headerFg}` : "",
    ]
      .filter(Boolean)
      .join(";");
    html += `<th style="${headStyle}">${escapeHtmlText(column.label)}</th>`;
  }
  html += "</tr></thead><tbody>";
  let total = 0;
  rows.forEach((row, index) => {
    total += row.sum;
    const rowBg = zebra && index % 2 === 1 && zebraBg ? `background:${zebraBg}` : "";
    html += `<tr${rowBg ? ` style="${rowBg}"` : ""}>`;
    for (const column of columns) {
      const align =
        column.key === "name" || column.key === "sku" || column.key === "warranty" || column.key === "performer"
          ? "left"
          : "right";
      let value = "";
      switch (column.key) {
        case "index":
          value = String(index + 1);
          break;
        case "name":
          value = escapeHtmlText(row.name);
          break;
        case "sku":
          value = escapeHtmlText(row.sku);
          break;
        case "qty":
          value = String(row.qty);
          break;
        case "unit":
          value = escapeHtmlText(row.unit);
          break;
        case "price":
          value = money(row.price, ctx, env.showCents);
          break;
        case "discount":
          value = escapeHtmlText(row.discount);
          break;
        case "vat": {
          const vat = printContextVatBreakdown(ctx);
          value = vat ? money(vatIncludedAmount(row.sum, vat.rate), ctx, env.showCents) : "";
          break;
        }
        case "sum":
          value = money(row.sum, ctx, env.showCents);
          break;
        case "warranty":
          value = escapeHtmlText(row.warranty);
          break;
        case "performer":
          value = escapeHtmlText(row.performer);
          break;
      }
      html += `<td style="${cellBorder};padding:4px 6px;text-align:${align}">${value}</td>`;
    }
    html += "</tr>";
  });
  if (block.showTotalsRow) {
    html += `<tr><td colspan="${Math.max(columns.length - 1, 1)}" style="${cellBorder};padding:4px 6px;text-align:right;font-weight:600">Σ</td>`;
    html += `<td style="${cellBorder};padding:4px 6px;text-align:right;font-weight:600">${money(total, ctx, env.showCents)}</td></tr>`;
  }
  html += "</tbody></table>";
  return titledBlock(block.title, block.style, html, ctx, env);
}

function servicesSum(ctx: PrintContext) {
  const sections = sectionsOf(ctx);
  if (sections && ctx.invoice) return sections.worksSubtotal;
  return serviceRows(ctx.order).reduce((sum, row) => sum + row.sum, 0);
}
function materialsSum(ctx: PrintContext) {
  const sections = sectionsOf(ctx);
  if (sections && ctx.invoice) return sections.materialsSubtotal;
  return materialRows(ctx.order).reduce((sum, row) => sum + row.sum, 0);
}
function orderTotal(ctx: PrintContext) {
  if (ctx.invoice) return ctx.invoice.total;
  if (ctx.order) return ctx.order.totalPrice;
  return 0;
}
function orderDiscount(ctx: PrintContext) {
  if (ctx.order && typeof ctx.order.discountTotal === "number") return ctx.order.discountTotal;
  return Math.max(0, servicesSum(ctx) + materialsSum(ctx) - orderTotal(ctx));
}

function renderTotals(block: TotalsBlock, ctx: PrintContext, env: RenderEnv) {
  const vat = printContextVatBreakdown(ctx);
  const rows = block.rows.filter((row) => {
    if (!row.enabled) return false;
    if ((row.key === "net" || row.key === "vat" || row.key === "grossWithVat") && !vat) return false;
    return true;
  });
  if (rows.length === 0) return "";
  const align = block.style?.align === "left" ? "margin-right:auto;margin-left:0" : "margin-left:auto";
  let html = `<table style="width:100%;max-width:320px;${align};border-collapse:collapse">`;
  for (const row of rows) {
    let value = "";
    switch (row.key) {
      case "servicesSum":
        value = money(servicesSum(ctx), ctx, env.showCents);
        break;
      case "materialsSum":
        value = money(materialsSum(ctx), ctx, env.showCents);
        break;
      case "discount":
        value = money(orderDiscount(ctx), ctx, env.showCents);
        break;
      case "net":
        value = vat ? money(vat.net, ctx, env.showCents) : "";
        break;
      case "vat":
        value = vat ? money(vat.vat, ctx, env.showCents) : "";
        break;
      case "grossWithVat":
        value = vat ? money(vat.gross, ctx, env.showCents) : "";
        break;
      case "total":
        value = money(orderTotal(ctx), ctx, env.showCents);
        break;
      case "paid":
        value = money(ctx.paymentBalance?.netPaid ?? 0, ctx, env.showCents);
        break;
      case "remaining":
        value = money(ctx.paymentBalance?.remaining ?? 0, ctx, env.showCents);
        break;
      case "totalWords":
        value = escapeHtmlText(amountInWords(orderTotal(ctx), normalizeAmountInWordsLocale(ctx.locale)));
        break;
    }
    const labelHtml = applyTemplateText(row.label, ctx, env.showCents);
    html += `<tr><td style="padding:3px 8px;text-align:right;color:#444">${labelHtml}</td><td style="padding:3px 0;text-align:right;font-weight:600">${value}</td></tr>`;
  }
  html += "</table>";
  return titledBlock(block.title, block.style, html, ctx, env);
}

function fieldValueTemplate(field: FieldRef): string {
  if (typeof field.template === "string" && field.template.length > 0) return field.template;
  return field.token ?? "";
}

function renderFields(block: FieldsBlock, ctx: PrintContext, env: RenderEnv) {
  const enabled = block.fields.filter((field) => field.enabled);
  if (enabled.length === 0) return "";
  const hideDefault = true;
  const rows = enabled
    .map((field) => {
      const template = fieldValueTemplate(field);
      const hideIfEmpty = field.hideIfEmpty !== false && hideDefault;
      if (hideIfEmpty && !templateHasValue(template, ctx, env.showCents)) return "";
      const label = applyTemplateText(field.label, ctx, env.showCents);
      const value = applyTemplateText(template, ctx, env.showCents);
      return `<div><span style="color:#666">${label}${label ? ": " : ""}</span>${value}</div>`;
    })
    .filter(Boolean)
    .join("");
  if (!rows && !block.title) return "";
  const body = rows ? `<div style="display:grid;gap:4px;margin:4px 0">${rows}</div>` : "";
  return titledBlock(block.title, block.style, body, ctx, env);
}

function renderCompanyHeader(block: CompanyHeaderBlock, ctx: PrintContext, env: RenderEnv) {
  const align = block.style?.align ?? block.align;
  const parts: string[] = [];
  for (const field of block.fields.filter((item) => item.enabled)) {
    const template = fieldValueTemplate(field);
    if (template.includes("#КОМПАНИЯ-ЛОГОТИП") || field.token === "#КОМПАНИЯ-ЛОГОТИП") {
      const logo = formatToken("#КОМПАНИЯ-ЛОГОТИП", ctx, env.showCents);
      if (logo) parts.push(logo);
      continue;
    }
    if (field.hideIfEmpty !== false && !templateHasValue(template, ctx, env.showCents)) continue;
    parts.push(`<div>${applyTemplateText(template, ctx, env.showCents)}</div>`);
  }
  if (parts.length === 0) return "";
  return wrapStyled(parts.join(""), { ...block.style, align }, env, "margin-bottom:12px");
}

function resolveSignatureDateLabel(block: SignaturesBlock, ctx: PrintContext) {
  const override = block.dateLabel?.trim();
  if (override) return escapeHtmlText(override);
  const lng = isAppLanguage(ctx.locale) ? ctx.locale : currentLanguage();
  return escapeHtmlText(i18n.getFixedT(lng)("settings.printTemplates.builder.signatureDate"));
}

function renderSignatures(block: SignaturesBlock, ctx: PrintContext, env: RenderEnv) {
  if (block.labels.length === 0) return "";
  const dateCaption = resolveSignatureDateLabel(block, ctx);
  const cells = block.labels
    .map(
      (label) =>
        `<div style="flex:1;min-width:140px"><div style="border-bottom:1px solid #333;height:28px;margin-bottom:4px"></div><div style="font-size:0.9em">${escapeHtmlText(label)}</div><div style="margin-top:12px;border-bottom:1px solid #333;height:20px"></div><div style="font-size:0.85em;color:#666">${dateCaption}</div></div>`,
    )
    .join("");
  return wrapStyled(`<div style="display:flex;gap:24px;margin-top:12px">${cells}</div>`, block.style, env);
}

function renderColumns(block: ColumnsBlock, ctx: PrintContext, env: RenderEnv): string {
  if (!block.enabled) return "";
  const gap = block.gapMm ?? 3;
  const cells = block.columns
    .map((column) => {
      const inner = column.blocks.map((child) => renderBlock(child, ctx, env)).join("");
      return `<div style="flex:0 0 ${column.widthPercent}%;max-width:${column.widthPercent}%;box-sizing:border-box;padding:0 ${gap / 2}mm">${inner}</div>`;
    })
    .join("");
  return wrapStyled(
    `<div style="display:flex;flex-wrap:nowrap;align-items:flex-start;gap:${gap}mm;width:100%;box-sizing:border-box;break-inside:avoid">${cells}</div>`,
    block.style,
    env,
    "margin:8px 0",
  );
}

function renderDocumentTitle(block: DocumentTitleBlock, ctx: PrintContext, env: RenderEnv): string {
  const text = applyTemplateText(block.text, ctx, env.showCents);
  const useTitleChrome = Boolean(env.style) && !env.expandingShared;
  const title = env.style?.title;
  const color = useTitleChrome && title ? resolveColorRef(title.color, env.style!.colors) : undefined;
  const align = useTitleChrome && title ? title.align : block.style?.align;
  const sizePt = useTitleChrome && title ? title.sizePt : undefined;
  const uppercase = useTitleChrome && title?.uppercase ? "text-transform:uppercase" : "";
  const headCss = [
    sizePt ? `font-size:${sizePt}pt` : "font-size:1.35em",
    "margin:8px 0",
    color ? `color:${color}` : "",
    align ? `text-align:${align}` : "",
    uppercase,
  ]
    .filter(Boolean)
    .join(";");
  return wrapStyled(`<h1 style="${headCss}">${text}</h1>`, block.style, env);
}

function renderSharedSlot(kind: "styleHeader" | "styleFooter", ctx: PrintContext, env: RenderEnv): string {
  if (!env.style || env.expandingShared) return "";
  const blocks = kind === "styleHeader" ? env.style.sharedHeader : env.style.sharedFooter;
  const nested: RenderEnv = { ...env, expandingShared: true };
  return blocks.map((block) => renderBlock(block, ctx, nested)).join("");
}

function renderBlock(block: LayoutBlock, ctx: PrintContext, env: RenderEnv): string {
  if (!block.enabled) return "";
  switch (block.kind) {
    case "columns":
      return renderColumns(block, ctx, env);
    case "companyHeader":
      return renderCompanyHeader(block, ctx, env);
    case "documentTitle":
      return renderDocumentTitle(block, ctx, env);
    case "fields":
      return renderFields(block, ctx, env);
    case "table":
      return renderTable(block, ctx, env);
    case "totals":
      return renderTotals(block, ctx, env);
    case "warranty":
      return wrapStyled(formatToken("#ГАРАНТИЯ-СПИСОК", ctx, env.showCents), block.style, env);
    case "text":
      return wrapStyled(`<div>${applyTemplateText(block.html, ctx, env.showCents)}</div>`, block.style, env, "margin:8px 0");
    case "signatures":
      return renderSignatures(block, ctx, env);
    case "spacer":
      return `<div style="height:${block.heightMm ?? 8}mm"></div>`;
    case "divider":
      return `<hr style="border:none;border-top:1px solid #ccc;margin:12px 0" />`;
    case "styleHeader":
      return renderSharedSlot("styleHeader", ctx, env);
    case "styleFooter":
      return renderSharedSlot("styleFooter", ctx, env);
  }
}

export type RenderLayoutOptions = {
  showCents?: boolean;
  /** When layout.useStyle is true, apply this shared style (built-in default if omitted at call sites). */
  style?: LayoutRenderStyle | null;
};

/** @page + body font CSS for `buildPrintDocument` (kept outside sanitised body so `<style>` survives). */
export function layoutPageCss(page: DocumentLayoutPage, fontFamilyCss?: string) {
  const size = page.size === "A5" ? "A5" : "A4";
  const font = fontFamilyCss ? `font-family:${fontFamilyCss};` : "";
  return `@page{size:${size} ${page.orientation};margin:${page.marginsMm}mm}body{${font}font-size:${page.fontSizePt}pt;margin:0;color:#111}`;
}

/** Builds LayoutRenderStyle from a DocumentStyle-like object (avoids a hard import cycle). */
export function toLayoutRenderStyle(input: {
  colors: StyleColorPalette;
  title: LayoutRenderStyle["title"];
  table: LayoutRenderStyle["table"];
  sharedHeader: LayoutBlock[];
  sharedFooter: LayoutBlock[];
  fontFamilyCss?: string;
}): LayoutRenderStyle {
  return {
    colors: input.colors,
    title: input.title,
    table: input.table,
    sharedHeader: input.sharedHeader,
    sharedFooter: input.sharedFooter,
    fontFamilyCss: input.fontFamilyCss,
  };
}

/** Renders a layout to print-ready HTML fragment (then sanitizeTemplateHtml + buildPrintDocument). */
export function renderLayoutToHtml(layout: DocumentLayout, ctx: PrintContext, options: RenderLayoutOptions = {}) {
  const showCents = options.showCents !== false;
  const normalized = migrateLayoutToV2(layout);
  const useStyle = normalized.useStyle === true;
  const style = useStyle ? (options.style ?? null) : null;
  const env: RenderEnv = { showCents, style, expandingShared: false };
  const body = normalized.blocks.map((block) => renderBlock(block, ctx, env)).join("");
  if (style?.fontFamilyCss) {
    return `<div style="font-family:${style.fontFamilyCss}">${body}</div>`;
  }
  return body;
}

export function newBlockId(prefix = "b") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Flatten all leaf blocks (including those inside columns) in document order. */
export function flattenLayoutBlocks(blocks: LayoutBlock[]): LeafLayoutBlock[] {
  const out: LeafLayoutBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "columns") {
      for (const column of block.columns) {
        for (const child of column.blocks) {
          if (child.kind !== "columns") out.push(child);
        }
      }
    } else {
      out.push(block);
    }
  }
  return out;
}
