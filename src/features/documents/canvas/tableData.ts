/** Shared table / totals data for canvas rendering (mirrors layout.ts row logic). */

import type { InvoiceDocument, InvoiceItem, Order, OrderMaterial, OrderService } from "../../../lib/types";
import { vatIncludedAmount } from "../../finance/vat";
import type { InvoiceSections } from "../../invoices/invoiceItemSections";
import { lineTotal } from "../../invoices/invoiceItemSections";
import { lineNet } from "../../orders/orderTotals";
import { amountInWords, normalizeAmountInWordsLocale } from "../amountInWords";
import type { TableSource, TotalsRowKey } from "../layout";
import { escapeHtmlText, type PrintContext } from "../templateVariables";

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
  }));
}

function invoiceRows(invoice: InvoiceDocument | null): CanvasLineRow[] {
  return invoiceItemRows(invoice?.items ?? []);
}

function sectionsOf(ctx: PrintContext): InvoiceSections | null {
  return ctx.invoiceSections;
}

export function canvasRowsForSource(source: TableSource, ctx: PrintContext): CanvasLineRow[] {
  if (source === "services") return serviceRows(ctx.order);
  if (source === "materials") return materialRows(ctx.order);
  if (source === "invoiceLines") return invoiceRows(ctx.invoice);
  if (source === "invoiceWorks") return invoiceItemRows(sectionsOf(ctx)?.works ?? []);
  if (source === "invoiceMaterials") return invoiceItemRows(sectionsOf(ctx)?.materials ?? []);
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
  switch (key) {
    case "servicesSum":
      return formatCanvasMoney(servicesSum(ctx), ctx, showCents);
    case "materialsSum":
      return formatCanvasMoney(materialsSum(ctx), ctx, showCents);
    case "discount":
      return formatCanvasMoney(orderDiscount(ctx), ctx, showCents);
    case "vat":
      return formatCanvasMoney(vatIncludedAmount(orderTotal(ctx)), ctx, showCents);
    case "total":
      return formatCanvasMoney(orderTotal(ctx), ctx, showCents);
    case "paid":
      return formatCanvasMoney(ctx.paymentBalance?.netPaid ?? 0, ctx, showCents);
    case "remaining":
      return formatCanvasMoney(ctx.paymentBalance?.remaining ?? 0, ctx, showCents);
    case "totalWords":
      return escapeHtmlText(amountInWords(orderTotal(ctx), normalizeAmountInWordsLocale(ctx.locale)));
  }
}

/** Estimated table body height in mm (header + rows + optional totals). */
export function estimateTableHeightMm(rowCount: number, showTotalsRow: boolean, baseHMm: number): number {
  const headerMm = 8;
  const rowMm = 6;
  const totalsMm = showTotalsRow ? 7 : 0;
  const computed = headerMm + rowCount * rowMm + totalsMm;
  return Math.max(baseHMm, computed);
}
