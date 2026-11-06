/** Versioned print-document layout model + HTML renderer for the visual builder. */

import type { InvoiceDocument, Order, OrderMaterial, OrderService } from "../../lib/types";
import { formatWorkspaceDate } from "../../lib/workspaceFormat";
import { vatIncludedAmount } from "../finance/vat";
import { lineNet } from "../orders/orderTotals";
import { amountInWords, normalizeAmountInWordsLocale } from "./amountInWords";
import {
  escapeHtmlText,
  TEMPLATE_VARIABLES,
  type PrintContext,
} from "./templateVariables";
import { applyTemplateVariables } from "./printTemplate";

export type PageSize = "A4" | "A5";
export type PageOrientation = "portrait" | "landscape";

export type DocumentLayoutPage = {
  size: PageSize;
  orientation: PageOrientation;
  marginsMm: number;
  fontSizePt: number;
};

export type FieldRef = { token: string; label: string; enabled: boolean };
export type TableColumnKey = "index" | "name" | "sku" | "qty" | "unit" | "price" | "discount" | "vat" | "sum" | "warranty";
export type TableColumn = { key: TableColumnKey; label: string; enabled: boolean; widthPercent?: number };
export type TableSource = "services" | "materials" | "allLines" | "invoiceLines";
export type TotalsRowKey =
  | "servicesSum"
  | "materialsSum"
  | "discount"
  | "vat"
  | "total"
  | "paid"
  | "remaining"
  | "totalWords";
export type TotalsRow = { key: TotalsRowKey; label: string; enabled: boolean };

export type LayoutBlockBase = { id: string; kind: string; enabled: boolean; title?: string };

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
export type SignaturesBlock = LayoutBlockBase & { kind: "signatures"; labels: string[] };
export type SpacerBlock = LayoutBlockBase & { kind: "spacer"; heightMm?: number };
export type DividerBlock = LayoutBlockBase & { kind: "divider" };

export type LayoutBlock =
  | CompanyHeaderBlock
  | DocumentTitleBlock
  | FieldsBlock
  | TableBlock
  | TotalsBlock
  | WarrantyBlock
  | TextBlock
  | SignaturesBlock
  | SpacerBlock
  | DividerBlock;

export type DocumentLayout = {
  version: 1;
  page: DocumentLayoutPage;
  blocks: LayoutBlock[];
};

export type DocumentTemplateType = "work_order" | "act" | "invoice";

const BLOCK_KINDS = new Set([
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
]);
const TABLE_KEYS = new Set<TableColumnKey>(["index", "name", "sku", "qty", "unit", "price", "discount", "vat", "sum", "warranty"]);
const TOTAL_KEYS = new Set<TotalsRowKey>(["servicesSum", "materialsSum", "discount", "vat", "total", "paid", "remaining", "totalWords"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFieldRef(value: unknown): value is FieldRef {
  return isRecord(value) && typeof value.token === "string" && typeof value.label === "string" && typeof value.enabled === "boolean";
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

function parseBlock(value: unknown): LayoutBlock | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string" || !BLOCK_KINDS.has(value.kind)) {
    return null;
  }
  const enabled = value.enabled !== false;
  const title = typeof value.title === "string" ? value.title : undefined;
  const base = { id: value.id, enabled, title };

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
        value.source === "materials" || value.source === "allLines" || value.source === "invoiceLines" ? value.source : "services";
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
      return { ...base, kind: "signatures", labels: value.labels };
    case "spacer":
      return {
        ...base,
        kind: "spacer",
        heightMm: typeof value.heightMm === "number" && Number.isFinite(value.heightMm) ? value.heightMm : 8,
      };
    case "divider":
      return { ...base, kind: "divider" };
    default:
      return null;
  }
}

/** Type guard for persisted layout JSON. Rejects unknown shapes. */
export function isDocumentLayout(value: unknown): value is DocumentLayout {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.page) || !Array.isArray(value.blocks)) return false;
  const page = value.page;
  if (page.size !== "A4" && page.size !== "A5") return false;
  if (page.orientation !== "portrait" && page.orientation !== "landscape") return false;
  if (typeof page.marginsMm !== "number" || !Number.isFinite(page.marginsMm)) return false;
  if (typeof page.fontSizePt !== "number" || !Number.isFinite(page.fontSizePt)) return false;
  return value.blocks.every((block) => parseBlock(block) != null);
}

export function parseDocumentLayout(value: unknown): DocumentLayout | null {
  if (!isDocumentLayout(value)) return null;
  const blocks = value.blocks.map((block) => parseBlock(block)).filter((block): block is LayoutBlock => block != null);
  return { version: 1, page: value.page, blocks };
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
    const text = String(raw);
    return escapeHtmlText(formatWorkspaceDate(text, ctx.dateFormat, ctx.timeZone));
  }
  return escapeHtmlText(String(raw));
}

function money(n: number, ctx: PrintContext, showCents: boolean) {
  const digits = showCents ? 2 : 0;
  const amount = n.toLocaleString(ctx.locale || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return escapeHtmlText(ctx.currency ? `${ctx.currency} ${amount}` : amount);
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
  }));
}

function invoiceRows(invoice: InvoiceDocument | null): LineRow[] {
  return (invoice?.items ?? []).map((item) => ({
    name: item.serviceName,
    sku: "",
    qty: item.quantity,
    unit: "",
    price: item.price,
    discount: "",
    sum: lineNet(item.price, item.quantity),
    warranty: "",
  }));
}

function rowsForSource(source: TableSource, ctx: PrintContext): LineRow[] {
  if (source === "services") return serviceRows(ctx.order);
  if (source === "materials") return materialRows(ctx.order);
  if (source === "invoiceLines") return invoiceRows(ctx.invoice);
  return [...serviceRows(ctx.order), ...materialRows(ctx.order)];
}

function renderTable(block: TableBlock, ctx: PrintContext, showCents: boolean) {
  const columns = block.columns.filter((column) => column.enabled);
  if (columns.length === 0) return "";
  const rows = rowsForSource(block.source, ctx);
  if (rows.length === 0) return "";
  const title = block.title ? `<h3 style="margin:12px 0 6px;font-size:1.05em">${escapeHtmlText(block.title)}</h3>` : "";
  let html = `${title}<table style="width:100%;border-collapse:collapse;margin:8px 0"><thead><tr>`;
  for (const column of columns) {
    const width = column.widthPercent ? `width:${column.widthPercent}%` : "";
    html += `<th style="border:1px solid #ccc;padding:4px 6px;text-align:left;${width}">${escapeHtmlText(column.label)}</th>`;
  }
  html += "</tr></thead><tbody>";
  let total = 0;
  rows.forEach((row, index) => {
    total += row.sum;
    html += "<tr>";
    for (const column of columns) {
      const align = column.key === "name" || column.key === "sku" || column.key === "warranty" ? "left" : "right";
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
          value = money(row.price, ctx, showCents);
          break;
        case "discount":
          value = escapeHtmlText(row.discount);
          break;
        case "vat":
          value = money(vatIncludedAmount(row.sum), ctx, showCents);
          break;
        case "sum":
          value = money(row.sum, ctx, showCents);
          break;
        case "warranty":
          value = escapeHtmlText(row.warranty);
          break;
      }
      html += `<td style="border:1px solid #ccc;padding:4px 6px;text-align:${align}">${value}</td>`;
    }
    html += "</tr>";
  });
  if (block.showTotalsRow) {
    html += `<tr><td colspan="${Math.max(columns.length - 1, 1)}" style="border:1px solid #ccc;padding:4px 6px;text-align:right;font-weight:600">Σ</td>`;
    html += `<td style="border:1px solid #ccc;padding:4px 6px;text-align:right;font-weight:600">${money(total, ctx, showCents)}</td></tr>`;
  }
  return `${html}</tbody></table>`;
}

function servicesSum(ctx: PrintContext) {
  return serviceRows(ctx.order).reduce((sum, row) => sum + row.sum, 0);
}
function materialsSum(ctx: PrintContext) {
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

function renderTotals(block: TotalsBlock, ctx: PrintContext, showCents: boolean) {
  const rows = block.rows.filter((row) => row.enabled);
  if (rows.length === 0) return "";
  let html = `<table style="width:100%;max-width:320px;margin-left:auto;border-collapse:collapse">`;
  for (const row of rows) {
    let value = "";
    switch (row.key) {
      case "servicesSum":
        value = money(servicesSum(ctx), ctx, showCents);
        break;
      case "materialsSum":
        value = money(materialsSum(ctx), ctx, showCents);
        break;
      case "discount":
        value = money(orderDiscount(ctx), ctx, showCents);
        break;
      case "vat":
        value = money(vatIncludedAmount(orderTotal(ctx)), ctx, showCents);
        break;
      case "total":
        value = money(orderTotal(ctx), ctx, showCents);
        break;
      case "paid":
        value = money(ctx.paymentBalance?.netPaid ?? 0, ctx, showCents);
        break;
      case "remaining":
        value = money(ctx.paymentBalance?.remaining ?? 0, ctx, showCents);
        break;
      case "totalWords":
        value = escapeHtmlText(amountInWords(orderTotal(ctx), normalizeAmountInWordsLocale(ctx.locale)));
        break;
    }
    html += `<tr><td style="padding:3px 8px;text-align:right;color:#444">${escapeHtmlText(row.label)}</td><td style="padding:3px 0;text-align:right;font-weight:600">${value}</td></tr>`;
  }
  return `${html}</table>`;
}

function renderFields(fields: FieldRef[], ctx: PrintContext, showCents: boolean, title?: string) {
  const enabled = fields.filter((field) => field.enabled);
  if (enabled.length === 0) return "";
  const heading = title ? `<h3 style="margin:12px 0 6px;font-size:1.05em">${escapeHtmlText(title)}</h3>` : "";
  const rows = enabled
    .map((field) => {
      const value = formatToken(field.token, ctx, showCents);
      if (!value) return `<div><span style="color:#666">${escapeHtmlText(field.label)}:</span> </div>`;
      return `<div><span style="color:#666">${escapeHtmlText(field.label)}:</span> ${value}</div>`;
    })
    .join("");
  return `${heading}<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:8px 0">${rows}</div>`;
}

function renderCompanyHeader(block: CompanyHeaderBlock, ctx: PrintContext, showCents: boolean) {
  const align = block.align;
  const parts: string[] = [];
  for (const field of block.fields.filter((item) => item.enabled)) {
    if (field.token === "#КОМПАНИЯ-ЛОГОТИП") {
      const logo = formatToken(field.token, ctx, showCents);
      if (logo) parts.push(logo);
      continue;
    }
    const value = formatToken(field.token, ctx, showCents);
    if (!value) continue;
    parts.push(`<div>${value}</div>`);
  }
  if (parts.length === 0) return "";
  return `<div style="text-align:${align};margin-bottom:12px">${parts.join("")}</div>`;
}

function renderSignatures(block: SignaturesBlock) {
  if (block.labels.length === 0) return "";
  const cells = block.labels
    .map(
      (label) =>
        `<div style="flex:1;min-width:140px"><div style="border-bottom:1px solid #333;height:28px;margin-bottom:4px"></div><div style="font-size:0.9em">${escapeHtmlText(label)}</div><div style="margin-top:12px;border-bottom:1px solid #333;height:20px"></div><div style="font-size:0.85em;color:#666">Date</div></div>`,
    )
    .join("");
  return `<div style="display:flex;gap:24px;margin-top:28px">${cells}</div>`;
}

function renderBlock(block: LayoutBlock, ctx: PrintContext, showCents: boolean): string {
  if (!block.enabled) return "";
  switch (block.kind) {
    case "companyHeader":
      return renderCompanyHeader(block, ctx, showCents);
    case "documentTitle":
      return `<h1 style="font-size:1.35em;margin:12px 0;text-align:center">${applyTemplateVariables(block.text, ctx, { showCents, currency: ctx.currency, locale: ctx.locale })}</h1>`;
    case "fields":
      return renderFields(block.fields, ctx, showCents, block.title);
    case "table":
      return renderTable(block, ctx, showCents);
    case "totals":
      return renderTotals(block, ctx, showCents);
    case "warranty":
      return formatToken("#ГАРАНТИЯ-СПИСОК", ctx, showCents);
    case "text":
      return `<div style="margin:8px 0">${applyTemplateVariables(block.html, ctx, { showCents, currency: ctx.currency, locale: ctx.locale })}</div>`;
    case "signatures":
      return renderSignatures(block);
    case "spacer":
      return `<div style="height:${block.heightMm ?? 8}mm"></div>`;
    case "divider":
      return `<hr style="border:none;border-top:1px solid #ccc;margin:12px 0" />`;
  }
}

export type RenderLayoutOptions = { showCents?: boolean };

/** @page + body font CSS for `buildPrintDocument` (kept outside sanitised body so `<style>` survives). */
export function layoutPageCss(page: DocumentLayoutPage) {
  const size = page.size === "A5" ? "A5" : "A4";
  return `@page{size:${size} ${page.orientation};margin:${page.marginsMm}mm}body{font-size:${page.fontSizePt}pt;margin:0}`;
}

/** Renders a layout to print-ready HTML fragment (then sanitizeTemplateHtml + buildPrintDocument). */
export function renderLayoutToHtml(layout: DocumentLayout, ctx: PrintContext, options: RenderLayoutOptions = {}) {
  const showCents = options.showCents !== false;
  return layout.blocks.map((block) => renderBlock(block, ctx, showCents)).join("");
}

export function newBlockId(prefix = "b") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
