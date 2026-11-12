/** Shared table / totals data for canvas rendering (mirrors layout.ts row logic). */

import i18n from "../../../i18n";
import type { InvoiceDocument, InvoiceItem, Order, OrderMaterial, OrderService } from "../../../lib/types";
import type { InvoiceSections } from "../../invoices/invoiceItemSections";
import { lineTotal } from "../../invoices/invoiceItemSections";
import { lineNet } from "../../orders/orderTotals";
import { amountInWords, normalizeAmountInWordsLocale } from "../amountInWords";
import type { TableSource, TotalsRowKey } from "../layout";
import { escapeHtmlText, printContextVatBreakdown, type PrintContext } from "../templateVariables";

export type CanvasLineRow = {
  name: string;
  sku: string;
  qty: number;
  unit: string;
  price: number;
  discount: string;
  sum: number;
  warranty: string;
  performer: string;
  /** Per-order line comment; empty for invoices and when print stripped private comments. */
  comment: string;
};

function serviceRows(order: Order | null): CanvasLineRow[] {
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
    comment: line.comment?.trim() || "",
  }));
}

function materialRows(order: Order | null): CanvasLineRow[] {
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
    comment: line.comment?.trim() || "",
  }));
}

function invoiceItemRows(items: InvoiceItem[]): CanvasLineRow[] {
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
    comment: "",
  }));
}

function invoiceRows(invoice: InvoiceDocument | null): CanvasLineRow[] {
  return invoiceItemRows(invoice?.items ?? []);
}

function sectionsOf(ctx: PrintContext): InvoiceSections | null {
  return ctx.invoiceSections;
}

function orderNumberOf(ctx: PrintContext): string {
  return ctx.order?.orderNumber?.trim() || ctx.invoice?.orderNumber?.trim() || "";
}

function paymentLineRow(ctx: PrintContext, kind: "prepayment" | "balance"): CanvasLineRow[] {
  const number = orderNumberOf(ctx);
  const amount =
    kind === "prepayment"
      ? (ctx.paymentBalance?.netPaid ?? 0)
      : (ctx.paymentBalance?.remaining ?? 0);
  const nameKey =
    kind === "prepayment"
      ? "settings.printTemplates.canvas.defaults.prepaymentLine"
      : "settings.printTemplates.canvas.defaults.balanceLine";
  const name = String(
    i18n.t(nameKey as "settings.printTemplates.canvas.defaults.prepaymentLine", {
      number,
      defaultValue:
        kind === "prepayment"
          ? `Prepayment for order No. ${number}`
          : `Balance payment for order No. ${number}`,
    }),
  );
  return [
    {
      name,
      sku: "",
      qty: 1,
      unit: "",
      price: amount,
      discount: "",
      sum: amount,
      warranty: "",
      performer: "",
      comment: "",
    },
  ];
}

export function canvasRowsForSource(source: TableSource, ctx: PrintContext): CanvasLineRow[] {
  if (source === "services") return serviceRows(ctx.order);
  if (source === "materials") return materialRows(ctx.order);
  if (source === "invoiceLines") return invoiceRows(ctx.invoice);
  if (source === "invoiceWorks") return invoiceItemRows(sectionsOf(ctx)?.works ?? []);
  if (source === "invoiceMaterials") return invoiceItemRows(sectionsOf(ctx)?.materials ?? []);
  if (source === "prepaymentLine") return paymentLineRow(ctx, "prepayment");
  if (source === "balanceLine") return paymentLineRow(ctx, "balance");
  return [...serviceRows(ctx.order), ...materialRows(ctx.order)];
}

export function formatCanvasMoney(n: number, ctx: PrintContext, showCents: boolean): string {
  const digits = showCents ? 2 : 0;
  const amount = n.toLocaleString(ctx.locale || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return escapeHtmlText(ctx.currency ? `${ctx.currency} ${amount}` : amount);
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

export function canvasTotalsValue(key: TotalsRowKey, ctx: PrintContext, showCents: boolean): string {
  const vat = printContextVatBreakdown(ctx);
  switch (key) {
    case "servicesSum":
      return formatCanvasMoney(servicesSum(ctx), ctx, showCents);
    case "materialsSum":
      return formatCanvasMoney(materialsSum(ctx), ctx, showCents);
    case "discount":
      return formatCanvasMoney(orderDiscount(ctx), ctx, showCents);
    case "net":
      return vat ? formatCanvasMoney(vat.net, ctx, showCents) : "";
    case "vat":
      return vat ? formatCanvasMoney(vat.vat, ctx, showCents) : "";
    case "grossWithVat":
      return vat ? formatCanvasMoney(vat.gross, ctx, showCents) : "";
    case "total":
      return formatCanvasMoney(orderTotal(ctx), ctx, showCents);
    case "paid":
      return formatCanvasMoney(ctx.paymentBalance?.netPaid ?? 0, ctx, showCents);
    case "remaining":
      return formatCanvasMoney(ctx.paymentBalance?.remaining ?? 0, ctx, showCents);
    case "totalWords":
      return escapeHtmlText(amountInWords(orderTotal(ctx), normalizeAmountInWordsLocale(ctx.locale)));
    case "paidWords":
      return escapeHtmlText(
        amountInWords(ctx.paymentBalance?.netPaid ?? 0, normalizeAmountInWordsLocale(ctx.locale)),
      );
    case "remainingWords":
      return escapeHtmlText(
        amountInWords(ctx.paymentBalance?.remaining ?? 0, normalizeAmountInWordsLocale(ctx.locale)),
      );
  }
}

/** Whether a totals row should render for the current print context (VAT rows need a rate). */
export function canvasTotalsRowVisible(key: TotalsRowKey, ctx: PrintContext): boolean {
  if (key === "net" || key === "vat" || key === "grossWithVat") {
    return printContextVatBreakdown(ctx) != null;
  }
  return true;
}

/** Estimated table body height in mm (header + rows + optional totals). */
export function estimateTableHeightMm(rowCount: number, showTotalsRow: boolean, baseHMm: number): number {
  const headerMm = 8;
  const rowMm = 6;
  const totalsMm = showTotalsRow ? 7 : 0;
  const computed = headerMm + rowCount * rowMm + totalsMm;
  return Math.max(baseHMm, computed);
}

const TOTALS_ROW_MM = 8;
const TOTALS_WORDS_ROW_MM = 18;
const TOTALS_PADDING_MM = 6;

function isWordsTotalsRowKey(key: string): boolean {
  return key === "totalWords" || key === "paidWords" || key === "remainingWords";
}

/** Estimated totals box height in mm from enabled rows (padding + per-row height). */
export function estimateTotalsHeightMm(
  enabledRowCount: number,
  baseHMm = 0,
  rows?: Array<{ enabled: boolean; key?: string }>,
): number {
  if (rows && rows.length > 0) {
    const enabled = rows.filter((row) => row.enabled);
    if (enabled.length === 0) return Math.max(baseHMm, TOTALS_PADDING_MM);
    const content = enabled.reduce(
      (sum, row) => sum + (row.key && isWordsTotalsRowKey(row.key) ? TOTALS_WORDS_ROW_MM : TOTALS_ROW_MM),
      0,
    );
    return Math.max(baseHMm, TOTALS_PADDING_MM + content);
  }
  if (enabledRowCount <= 0) return Math.max(baseHMm, TOTALS_PADDING_MM);
  return Math.max(baseHMm, TOTALS_PADDING_MM + enabledRowCount * TOTALS_ROW_MM);
}

/** True when a totals element's stored height can fit all of its enabled rows. */
export function totalsElementHeightFitsRows(el: {
  hMm: number;
  rows: Array<{ enabled: boolean; key?: string }>;
}): boolean {
  return el.hMm + 0.01 >= estimateTotalsHeightMm(el.rows.length, 0, el.rows);
}
