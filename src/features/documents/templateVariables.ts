import i18n, { currentLanguage } from "../../i18n";
import { isAppLanguage } from "../../i18n/languages";
import type { Client, InvoiceDocument, Order, OrderMaterial, OrderService, Vehicle } from "../../lib/types";
import type { LegalEntity } from "../../services/apiLegalEntities";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import type { WarrantySnapshot } from "../orders/warranty";
import { snapshotMileageUnit } from "../orders/warranty";
import type { PaymentBalance } from "../finance/paymentTypes";
import { vatIncludedAmount } from "../finance/vat";
import type { InvoiceSections } from "../invoices/invoiceItemSections";
import { computeOrderMoney, lineNet } from "../orders/orderTotals";
import {
  formatVehicleMileage,
  mileageUnitAbbreviation,
  resolveOrderMileageUnit,
} from "../vehicles/vehicleMileage";
import { amountInWords, normalizeAmountInWordsLocale } from "./amountInWords";

/** Mirrors layout.DocumentTemplateType — kept local to avoid import cycles. */
export type PrintDocumentKind = "work_order" | "act" | "invoice";

export type VariableGroup =
  | "order"
  | "client"
  | "vehicle"
  | "company"
  | "staff"
  | "money"
  | "warranty"
  | "tables"
  | "invoice"
  | "document";

export type TemplateVariableKind = "text" | "money" | "date" | "datetime" | "number" | "html";

export type PrintContext = {
  order: Order | null;
  invoice: InvoiceDocument | null;
  /** Works/materials split for invoice tables (from classifyInvoiceItems). */
  invoiceSections: InvoiceSections | null;
  client: Client | null;
  vehicle: Vehicle | null;
  workspace: WorkspaceDetails | null;
  legalEntity: LegalEntity | null;
  logoUrl: string | null;
  currency: string;
  dateFormat: string;
  timeZone: string;
  /** Document / UI language for amount-in-words and labels. */
  locale: string;
  paymentBalance: PaymentBalance | null;
  warrantyRecords: WarrantySnapshot[];
  printedAt: Date;
  /** Which document is being printed — drives #ДОКУМЕНТ-* tokens. */
  documentKind: PrintDocumentKind | null;
};

export type TemplateVariable = {
  token: string;
  group: VariableGroup;
  labelKey: string;
  descriptionKey?: string;
  kind: TemplateVariableKind;
  resolve: (ctx: PrintContext) => string | number | null;
};

export const VARIABLE_GROUPS: VariableGroup[] = [
  "document",
  "order",
  "invoice",
  "client",
  "vehicle",
  "company",
  "staff",
  "money",
  "warranty",
  "tables",
];

export function emptyPrintContext(partial: Partial<PrintContext> = {}): PrintContext {
  return {
    order: null,
    invoice: null,
    invoiceSections: null,
    client: null,
    vehicle: null,
    workspace: null,
    legalEntity: null,
    logoUrl: null,
    currency: "",
    dateFormat: "DD.MM.YYYY",
    timeZone: "Europe/Chisinau",
    locale: "en",
    paymentBalance: null,
    warrantyRecords: [],
    printedAt: new Date(0),
    documentKind: null,
    ...partial,
  };
}

function documentTitleLabel(kind: PrintDocumentKind | null, locale: string): string | null {
  if (!kind) return null;
  const lng = isAppLanguage(locale) ? locale : currentLanguage();
  const t = i18n.getFixedT(lng);
  if (kind === "invoice") return t("settings.printTemplates.docTitleInvoice");
  if (kind === "act") return t("settings.printTemplates.docTitleAct");
  return t("settings.printTemplates.docTitleWorkOrder");
}

function documentNumber(ctx: PrintContext): string | null {
  if (ctx.documentKind === "invoice" || (ctx.documentKind == null && ctx.invoice)) {
    return text(ctx.invoice?.invoiceNumber);
  }
  return text(ctx.order?.orderNumber);
}

function documentDate(ctx: PrintContext): string | null {
  if (ctx.documentKind === "invoice" || (ctx.documentKind == null && ctx.invoice && !ctx.order)) {
    return text(ctx.invoice?.createdAt);
  }
  return text(ctx.order?.createdAt);
}

function text(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

function statusLabel(order: Order | null) {
  if (!order) return null;
  return text(order.customStatus?.name) || text(order.status);
}

function companyName(ctx: PrintContext) {
  return text(ctx.legalEntity?.legalName) || text(ctx.workspace?.name);
}

function companyAddress(ctx: PrintContext) {
  return text(ctx.legalEntity?.address) || text(ctx.workspace?.companyAddress);
}

function companyEmail(ctx: PrintContext) {
  return text(ctx.legalEntity?.billingEmail) || text(ctx.workspace?.billingEmail);
}

function companyIdno(ctx: PrintContext) {
  return text(ctx.legalEntity?.taxNumber) || text(ctx.workspace?.taxVatNumber) || text(ctx.workspace?.registrationNumber);
}

function companyIban(ctx: PrintContext) {
  return text(ctx.legalEntity?.iban) || text(ctx.workspace?.iban);
}

function companyBank(ctx: PrintContext) {
  return text(ctx.legalEntity?.bankName) || text(ctx.workspace?.bankName);
}

function companyRegistration(ctx: PrintContext) {
  return text(ctx.legalEntity?.registrationNumber) || text(ctx.workspace?.registrationNumber);
}

function companyBankCode(ctx: PrintContext) {
  return text(ctx.legalEntity?.bankCode) || text(ctx.workspace?.bankCode);
}

function companyExtraInfo(ctx: PrintContext) {
  return text(ctx.legalEntity?.additionalInfo) || text(ctx.workspace?.printExtraInfo);
}

function moneyLines(order: Order | null) {
  const services = (order?.services ?? []).map((line) => ({
    price: line.price,
    qty: line.quantity,
    discountType: line.discountType,
    discountValue: line.discountValue,
  }));
  const materials = (order?.materials ?? []).map((line) => ({
    price: line.price,
    qty: line.quantity,
    discountType: line.discountType,
    discountValue: line.discountValue,
  }));
  return { services, materials, money: computeOrderMoney({ services, materials }) };
}

function servicesSum(order: Order | null) {
  return moneyLines(order).services.reduce(
    (sum, line) => sum + lineNet(line.price, line.qty, line.discountType, line.discountValue),
    0,
  );
}

function materialsSum(order: Order | null) {
  return moneyLines(order).materials.reduce(
    (sum, line) => sum + lineNet(line.price, line.qty, line.discountType, line.discountValue),
    0,
  );
}

function orderDiscount(order: Order | null) {
  if (!order) return null;
  if (typeof order.discountTotal === "number" && Number.isFinite(order.discountTotal)) return order.discountTotal;
  return moneyLines(order).money.discountTotal;
}

function orderTotal(order: Order | null) {
  if (!order) return null;
  if (Number.isFinite(order.totalPrice)) return order.totalPrice;
  return moneyLines(order).money.total;
}

function documentTotal(ctx: PrintContext) {
  if (ctx.invoice && Number.isFinite(ctx.invoice.total)) return ctx.invoice.total;
  return orderTotal(ctx.order);
}

function buyerName(ctx: PrintContext) {
  return text(ctx.client?.name) || text(ctx.invoice?.clientName) || text(ctx.order?.clientName);
}

function buyerPhone(ctx: PrintContext) {
  return text(ctx.client?.phone) || text(ctx.invoice?.clientPhone) || text(ctx.order?.clientPhone);
}

function buyerEmail(ctx: PrintContext) {
  return text(ctx.client?.email) || text(ctx.order?.clientEmail);
}

function buyerAddress(ctx: PrintContext) {
  return text(ctx.client?.address);
}

function buyerIdno(ctx: PrintContext) {
  return text(ctx.client?.tax_id);
}

/** Escape text for HTML attributes and cell content. */
export function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDiscountLabel(line: Pick<OrderService | OrderMaterial, "discountType" | "discountValue">) {
  if (line.discountType === "percent" && line.discountValue != null && line.discountValue > 0) {
    return `${line.discountValue}%`;
  }
  if (line.discountType === "amount" && line.discountValue != null && line.discountValue > 0) {
    return String(line.discountValue);
  }
  return "";
}

function tableStart(headers: string[]) {
  const head = headers.map((h) => `<th style="border:1px solid #ccc;padding:4px 6px;text-align:left">${escapeHtmlText(h)}</th>`).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>${head}</tr></thead><tbody>`;
}

function tableEnd() {
  return "</tbody></table>";
}

function cell(value: string, align: "left" | "right" = "left") {
  return `<td style="border:1px solid #ccc;padding:4px 6px;text-align:${align}">${value}</td>`;
}

function buildServicesTable(ctx: PrintContext) {
  const services = ctx.order?.services ?? [];
  if (services.length === 0) return "";
  let html = tableStart(["№", "Name", "Qty", "Price", "Discount", "Sum"]);
  services.forEach((line, index) => {
    const sum = lineNet(line.price, line.quantity, line.discountType, line.discountValue);
    html += `<tr>${cell(String(index + 1))}${cell(escapeHtmlText(line.serviceName))}${cell(String(line.quantity), "right")}${cell(String(line.price), "right")}${cell(escapeHtmlText(formatDiscountLabel(line)), "right")}${cell(String(sum), "right")}</tr>`;
  });
  return html + tableEnd();
}

function buildMaterialsTable(ctx: PrintContext) {
  const materials = ctx.order?.materials ?? [];
  if (materials.length === 0) return "";
  let html = tableStart(["№", "Name", "Article", "Qty", "Price", "Sum"]);
  materials.forEach((line, index) => {
    const sum = lineNet(line.price, line.quantity, line.discountType, line.discountValue);
    html += `<tr>${cell(String(index + 1))}${cell(escapeHtmlText(line.itemName))}${cell("")}${cell(String(line.quantity), "right")}${cell(String(line.price), "right")}${cell(String(sum), "right")}</tr>`;
  });
  return html + tableEnd();
}

function buildCombinedTable(ctx: PrintContext) {
  const services = ctx.order?.services ?? [];
  const materials = ctx.order?.materials ?? [];
  if (services.length === 0 && materials.length === 0) return "";
  let html = tableStart(["№", "Type", "Name", "Qty", "Price", "Sum"]);
  let n = 0;
  for (const line of services) {
    n += 1;
    const sum = lineNet(line.price, line.quantity, line.discountType, line.discountValue);
    html += `<tr>${cell(String(n))}${cell("Service")}${cell(escapeHtmlText(line.serviceName))}${cell(String(line.quantity), "right")}${cell(String(line.price), "right")}${cell(String(sum), "right")}</tr>`;
  }
  for (const line of materials) {
    n += 1;
    const sum = lineNet(line.price, line.quantity, line.discountType, line.discountValue);
    html += `<tr>${cell(String(n))}${cell("Material")}${cell(escapeHtmlText(line.itemName))}${cell(String(line.quantity), "right")}${cell(String(line.price), "right")}${cell(String(sum), "right")}</tr>`;
  }
  return html + tableEnd();
}

function printMileageT(locale: string) {
  const lng = isAppLanguage(locale) ? locale : currentLanguage();
  return i18n.getFixedT(lng);
}

function buildWarrantyList(ctx: PrintContext) {
  if (ctx.warrantyRecords.length === 0) return "";
  const t = printMileageT(ctx.locale);
  const items = ctx.warrantyRecords
    .map((row) => {
      const name = escapeHtmlText(row.itemName || "—");
      const untilDate = row.endsOn ? escapeHtmlText(row.endsOn) : "—";
      const unit = snapshotMileageUnit(row);
      const untilMileage =
        row.expiresAtMileage != null && Number.isFinite(row.expiresAtMileage)
          ? escapeHtmlText(formatVehicleMileage(row.expiresAtMileage, unit, t, { locale: ctx.locale }))
          : "—";
      return `<li><strong>${name}</strong> — until ${untilDate}, until mileage ${untilMileage}</li>`;
    })
    .join("");
  return `<ul style="margin:0;padding-left:1.2em">${items}</ul>`;
}

function logoHtml(ctx: PrintContext) {
  const url = text(ctx.logoUrl);
  if (!url) return "";
  // Only allow http(s) URLs in generated markup.
  if (!/^https?:\/\//i.test(url)) return "";
  return `<img src="${escapeHtmlText(url)}" alt="" style="max-height:64px;max-width:200px" />`;
}

/**
 * Registry of print-template tokens. Tokens without a backing field in the current
 * schema are intentionally omitted (e.g. company phone, order notes).
 */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  // Cross-document (resolved from documentKind)
  {
    token: "#ДОКУМЕНТ-НАЗВАНИЕ",
    group: "document",
    labelKey: "settings.printTemplates.variables.document.title.label",
    descriptionKey: "settings.printTemplates.variables.document.title.description",
    kind: "text",
    resolve: (ctx) => documentTitleLabel(ctx.documentKind, ctx.locale),
  },
  {
    token: "#ДОКУМЕНТ-НОМЕР",
    group: "document",
    labelKey: "settings.printTemplates.variables.document.number.label",
    descriptionKey: "settings.printTemplates.variables.document.number.description",
    kind: "text",
    resolve: (ctx) => documentNumber(ctx),
  },
  {
    token: "#ДОКУМЕНТ-ДАТА",
    group: "document",
    labelKey: "settings.printTemplates.variables.document.date.label",
    descriptionKey: "settings.printTemplates.variables.document.date.description",
    kind: "date",
    resolve: (ctx) => documentDate(ctx),
  },

  // Order
  {
    token: "#ЗАКАЗ-НОМЕР",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.number.label",
    descriptionKey: "settings.printTemplates.variables.order.number.description",
    kind: "text",
    resolve: (ctx) => text(ctx.order?.orderNumber),
  },
  {
    token: "#ЗАКАЗ-ДАТА",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.createdAt.label",
    descriptionKey: "settings.printTemplates.variables.order.createdAt.description",
    kind: "date",
    resolve: (ctx) => text(ctx.order?.createdAt),
  },
  {
    token: "#ЗАКАЗ-ДАТА-ЗАКРЫТИЯ",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.closedAt.label",
    descriptionKey: "settings.printTemplates.variables.order.closedAt.description",
    kind: "date",
    resolve: (ctx) => text(ctx.order?.closedAt),
  },
  {
    token: "#СТАТУС",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.status.label",
    descriptionKey: "settings.printTemplates.variables.order.status.description",
    kind: "text",
    resolve: (ctx) => statusLabel(ctx.order),
  },
  {
    token: "#ЗАКАЗ-ОПИСАНИЕ",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.description.label",
    descriptionKey: "settings.printTemplates.variables.order.description.description",
    kind: "text",
    resolve: (ctx) => text(ctx.order?.description),
  },
  {
    token: "#ЗАКАЗ-ПРОБЕГ",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.mileage.label",
    descriptionKey: "settings.printTemplates.variables.order.mileage.description",
    kind: "text",
    resolve: (ctx) => {
      const value = ctx.order?.vehicleMileageSnapshot;
      if (value == null || !Number.isFinite(value)) return null;
      const unit = resolveOrderMileageUnit({
        snapshotUnit: ctx.order?.vehicleMileageUnitSnapshot,
        vehicleUnit: ctx.vehicle?.mileageUnit,
      });
      return formatVehicleMileage(value, unit, printMileageT(ctx.locale), { locale: ctx.locale });
    },
  },
  {
    token: "#ЕДИНИЦА-ПРОБЕГА",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.mileageUnit.label",
    descriptionKey: "settings.printTemplates.variables.order.mileageUnit.description",
    kind: "text",
    resolve: (ctx) => {
      const snapshotUnit = ctx.order?.vehicleMileageUnitSnapshot;
      const vehicleUnit = ctx.vehicle?.mileageUnit;
      if (snapshotUnit !== "km" && snapshotUnit !== "mi" && vehicleUnit !== "km" && vehicleUnit !== "mi") {
        return null;
      }
      const unit = resolveOrderMileageUnit({ snapshotUnit, vehicleUnit });
      return mileageUnitAbbreviation(unit, printMileageT(ctx.locale)) || null;
    },
  },
  {
    token: "#НАЛОГОВАЯ-НАКЛАДНАЯ",
    group: "order",
    labelKey: "settings.printTemplates.variables.order.taxInvoice.label",
    descriptionKey: "settings.printTemplates.variables.order.taxInvoice.description",
    kind: "text",
    resolve: (ctx) => text(ctx.order?.taxInvoiceNumber),
  },

  // Invoice (fields that exist on Invoice / InvoiceDocument)
  {
    token: "#СЧЁТ-НОМЕР",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.number.label",
    descriptionKey: "settings.printTemplates.variables.invoice.number.description",
    kind: "text",
    resolve: (ctx) => text(ctx.invoice?.invoiceNumber),
  },
  {
    token: "#СЧЁТ-ДАТА",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.createdAt.label",
    descriptionKey: "settings.printTemplates.variables.invoice.createdAt.description",
    kind: "date",
    resolve: (ctx) => text(ctx.invoice?.createdAt),
  },
  {
    token: "#СЧЁТ-СРОК-ОПЛАТЫ",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.dueDate.label",
    descriptionKey: "settings.printTemplates.variables.invoice.dueDate.description",
    kind: "date",
    resolve: (ctx) => text(ctx.invoice?.dueDate),
  },
  {
    token: "#ПОКУПАТЕЛЬ-ИМЯ",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.buyerName.label",
    kind: "text",
    resolve: buyerName,
  },
  {
    token: "#ПОКУПАТЕЛЬ-ТЕЛЕФОН",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.buyerPhone.label",
    kind: "text",
    resolve: buyerPhone,
  },
  {
    token: "#ПОКУПАТЕЛЬ-EMAIL",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.buyerEmail.label",
    kind: "text",
    resolve: buyerEmail,
  },
  {
    token: "#ПОКУПАТЕЛЬ-АДРЕС",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.buyerAddress.label",
    kind: "text",
    resolve: buyerAddress,
  },
  {
    token: "#ПОКУПАТЕЛЬ-IDNO",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.buyerIdno.label",
    kind: "text",
    resolve: buyerIdno,
  },
  {
    token: "#СЧЁТ-СТАТУС",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.status.label",
    kind: "text",
    resolve: (ctx) => text(ctx.invoice?.status),
  },
  {
    token: "#СЧЁТ-ОПИСАНИЕ",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.notes.label",
    kind: "text",
    resolve: (ctx) => text(ctx.invoice?.description),
  },
  {
    token: "#СЧЁТ-ЗАКАЗ",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.orderNumber.label",
    kind: "text",
    resolve: (ctx) => text(ctx.invoice?.orderNumber) || text(ctx.order?.orderNumber),
  },
  {
    token: "#СЧЁТ-ОПЛАЧЕН",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.paidAt.label",
    kind: "date",
    resolve: (ctx) => text(ctx.invoice?.paidAt),
  },
  {
    token: "#СЧЁТ-УСТРОЙСТВО",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.device.label",
    kind: "text",
    resolve: (ctx) => text(ctx.invoice?.device) || text(ctx.order?.device),
  },
  {
    token: "#СЧЁТ-НОМЕР-АВТО",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.carNumber.label",
    kind: "text",
    resolve: (ctx) => text(ctx.invoice?.carNumber) || text(ctx.order?.carNumber) || text(ctx.vehicle?.licensePlate),
  },
  {
    token: "#СЧЁТ-VIN",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.vin.label",
    kind: "text",
    resolve: (ctx) => text(ctx.invoice?.vin) || text(ctx.order?.vin) || text(ctx.vehicle?.vin),
  },
  {
    token: "#СЧЁТ-СУММА-РАБОТ",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.worksSubtotal.label",
    kind: "money",
    resolve: (ctx) => ctx.invoiceSections?.worksSubtotal ?? null,
  },
  {
    token: "#СЧЁТ-СУММА-МАТЕРИАЛОВ",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.materialsSubtotal.label",
    kind: "money",
    resolve: (ctx) => ctx.invoiceSections?.materialsSubtotal ?? null,
  },
  {
    token: "#СЧЁТ-К-ОПЛАТЕ",
    group: "invoice",
    labelKey: "settings.printTemplates.variables.invoice.amountDue.label",
    kind: "money",
    resolve: (ctx) => {
      if (!ctx.invoice) return null;
      if (ctx.invoice.status === "paid") return 0;
      return ctx.invoiceSections?.grandTotal ?? ctx.invoice.total;
    },
  },

  // Client
  {
    token: "#КЛИЕНТ-ИМЯ",
    group: "client",
    labelKey: "settings.printTemplates.variables.client.name.label",
    descriptionKey: "settings.printTemplates.variables.client.name.description",
    kind: "text",
    resolve: (ctx) => text(ctx.client?.name) || text(ctx.order?.clientName),
  },
  {
    token: "#КЛИЕНТ-ТЕЛЕФОН",
    group: "client",
    labelKey: "settings.printTemplates.variables.client.phone.label",
    kind: "text",
    resolve: (ctx) => text(ctx.client?.phone) || text(ctx.order?.clientPhone),
  },
  {
    token: "#КЛИЕНТ-EMAIL",
    group: "client",
    labelKey: "settings.printTemplates.variables.client.email.label",
    kind: "text",
    resolve: (ctx) => text(ctx.client?.email) || text(ctx.order?.clientEmail),
  },
  {
    token: "#КЛИЕНТ-АДРЕС",
    group: "client",
    labelKey: "settings.printTemplates.variables.client.address.label",
    kind: "text",
    resolve: (ctx) => text(ctx.client?.address),
  },
  {
    token: "#КЛИЕНТ-ТИП",
    group: "client",
    labelKey: "settings.printTemplates.variables.client.type.label",
    kind: "text",
    resolve: (ctx) => text(ctx.client?.client_type) || text(ctx.order?.clientType ?? undefined),
  },
  {
    token: "#КЛИЕНТ-IDNO",
    group: "client",
    labelKey: "settings.printTemplates.variables.client.idno.label",
    descriptionKey: "settings.printTemplates.variables.client.idno.description",
    kind: "text",
    resolve: (ctx) => text(ctx.client?.tax_id),
  },

  // Vehicle
  {
    token: "#АВТО-МАРКА",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.make.label",
    kind: "text",
    resolve: (ctx) => text(ctx.vehicle?.make),
  },
  {
    token: "#АВТО-МОДЕЛЬ",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.model.label",
    kind: "text",
    resolve: (ctx) => text(ctx.vehicle?.model),
  },
  {
    token: "#АВТО-ГОД",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.year.label",
    kind: "number",
    resolve: (ctx) => ctx.vehicle?.year ?? null,
  },
  {
    token: "#АВТО-VIN",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.vin.label",
    kind: "text",
    resolve: (ctx) => text(ctx.vehicle?.vin) || text(ctx.order?.vin),
  },
  {
    token: "#АВТО-НОМЕР",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.plate.label",
    kind: "text",
    resolve: (ctx) => text(ctx.vehicle?.licensePlate) || text(ctx.order?.carNumber),
  },
  {
    token: "#АВТО-ПРОБЕГ",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.mileage.label",
    kind: "text",
    resolve: (ctx) => {
      const value = ctx.vehicle?.currentMileage;
      if (value == null || !Number.isFinite(value)) return null;
      return formatVehicleMileage(value, ctx.vehicle?.mileageUnit, printMileageT(ctx.locale), { locale: ctx.locale });
    },
  },
  {
    token: "#АВТО-ДВИГАТЕЛЬ",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.engine.label",
    kind: "number",
    resolve: (ctx) => ctx.vehicle?.engineDisplacement ?? null,
  },
  {
    token: "#АВТО-ТОПЛИВО",
    group: "vehicle",
    labelKey: "settings.printTemplates.variables.vehicle.fuel.label",
    kind: "text",
    resolve: (ctx) => text(ctx.vehicle?.fuelType),
  },

  // Company (workspace / default legal entity). No company phone field in schema → omitted.
  {
    token: "#КОМПАНИЯ-НАЗВАНИЕ",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.name.label",
    kind: "text",
    resolve: companyName,
  },
  {
    token: "#КОМПАНИЯ-АДРЕС",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.address.label",
    kind: "text",
    resolve: companyAddress,
  },
  {
    token: "#КОМПАНИЯ-EMAIL",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.email.label",
    kind: "text",
    resolve: companyEmail,
  },
  {
    token: "#КОМПАНИЯ-IDNO",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.idno.label",
    kind: "text",
    resolve: companyIdno,
  },
  {
    token: "#КОМПАНИЯ-IBAN",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.iban.label",
    kind: "text",
    resolve: companyIban,
  },
  {
    token: "#КОМПАНИЯ-БАНК",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.bank.label",
    kind: "text",
    resolve: companyBank,
  },
  {
    token: "#КОМПАНИЯ-РЕГИСТРАЦИЯ",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.registration.label",
    kind: "text",
    resolve: companyRegistration,
  },
  {
    token: "#КОМПАНИЯ-БИК",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.bankCode.label",
    kind: "text",
    resolve: companyBankCode,
  },
  {
    token: "#КОМПАНИЯ-ДОПИНФО",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.extraInfo.label",
    kind: "text",
    resolve: companyExtraInfo,
  },
  {
    token: "#КОМПАНИЯ-ЛОГОТИП",
    group: "company",
    labelKey: "settings.printTemplates.variables.company.logo.label",
    descriptionKey: "settings.printTemplates.variables.company.logo.description",
    kind: "html",
    resolve: logoHtml,
  },

  // Staff
  {
    token: "#ИСПОЛНИТЕЛЬ",
    group: "staff",
    labelKey: "settings.printTemplates.variables.staff.assignee.label",
    kind: "text",
    resolve: (ctx) => text(ctx.order?.assignedEmployeeName),
  },
  {
    token: "#ПРИНЯЛ",
    group: "staff",
    labelKey: "settings.printTemplates.variables.staff.acceptedBy.label",
    descriptionKey: "settings.printTemplates.variables.staff.acceptedBy.description",
    kind: "text",
    resolve: (ctx) => text(ctx.order?.createdByName),
  },
  {
    token: "#ДАТА-ПЕЧАТИ",
    group: "staff",
    labelKey: "settings.printTemplates.variables.staff.printedAt.label",
    kind: "datetime",
    resolve: (ctx) => ctx.printedAt.toISOString(),
  },

  // Money — longer #ИТОГО-ПРОПИСЬЮ must be registered (replacement sorts by length)
  {
    token: "#СУММА-УСЛУГ",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.services.label",
    kind: "money",
    resolve: (ctx) => (ctx.order ? servicesSum(ctx.order) : null),
  },
  {
    token: "#СУММА-МАТЕРИАЛОВ",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.materials.label",
    kind: "money",
    resolve: (ctx) => (ctx.order ? materialsSum(ctx.order) : null),
  },
  {
    token: "#СКИДКА",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.discount.label",
    kind: "money",
    resolve: (ctx) => orderDiscount(ctx.order),
  },
  {
    token: "#ИТОГО-ПРОПИСЬЮ",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.totalWords.label",
    descriptionKey: "settings.printTemplates.variables.money.totalWords.description",
    kind: "text",
    resolve: (ctx) => {
      const total = documentTotal(ctx);
      if (total == null) return null;
      return amountInWords(total, normalizeAmountInWordsLocale(ctx.locale));
    },
  },
  {
    token: "#ИТОГО",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.total.label",
    kind: "money",
    resolve: (ctx) => documentTotal(ctx),
  },
  {
    token: "#НДС",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.vat.label",
    descriptionKey: "settings.printTemplates.variables.money.vat.description",
    kind: "money",
    resolve: (ctx) => {
      const total = documentTotal(ctx);
      return total == null ? null : vatIncludedAmount(total);
    },
  },
  {
    token: "#ОПЛАЧЕНО",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.paid.label",
    kind: "money",
    resolve: (ctx) => ctx.paymentBalance?.netPaid ?? null,
  },
  {
    token: "#ОСТАТОК",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.remaining.label",
    kind: "money",
    resolve: (ctx) => ctx.paymentBalance?.remaining ?? null,
  },
  {
    token: "#ВАЛЮТА",
    group: "money",
    labelKey: "settings.printTemplates.variables.money.currency.label",
    kind: "text",
    resolve: (ctx) => text(ctx.currency),
  },

  // Warranty / tables
  {
    token: "#ГАРАНТИЯ-СПИСОК",
    group: "warranty",
    labelKey: "settings.printTemplates.variables.warranty.list.label",
    descriptionKey: "settings.printTemplates.variables.warranty.list.description",
    kind: "html",
    resolve: buildWarrantyList,
  },
  {
    token: "#ТАБЛИЦА-УСЛУГ",
    group: "tables",
    labelKey: "settings.printTemplates.variables.tables.services.label",
    kind: "html",
    resolve: buildServicesTable,
  },
  {
    token: "#ТАБЛИЦА-МАТЕРИАЛОВ",
    group: "tables",
    labelKey: "settings.printTemplates.variables.tables.materials.label",
    descriptionKey: "settings.printTemplates.variables.tables.materials.description",
    kind: "html",
    resolve: buildMaterialsTable,
  },
  {
    token: "#ТАБЛИЦА-ПОЗИЦИЙ",
    group: "tables",
    labelKey: "settings.printTemplates.variables.tables.lines.label",
    kind: "html",
    resolve: buildCombinedTable,
  },
];

const TOKEN_PATTERN = /#[A-ZА-ЯЁ0-9-]+/giu;

/** Tokens sorted longest-first so `#ИТОГО-ПРОПИСЬЮ` wins over `#ИТОГО`. */
export function templateVariablesByTokenLength(): TemplateVariable[] {
  return [...TEMPLATE_VARIABLES].sort((a, b) => b.token.length - a.token.length);
}

export function knownTemplateTokens(): Set<string> {
  return new Set(TEMPLATE_VARIABLES.map((variable) => variable.token));
}

/** `#TOKENS` present in HTML that are not in the registry. */
export function findUnknownTemplateTokens(html: string): string[] {
  const known = knownTemplateTokens();
  const found = new Set<string>();
  for (const match of html.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (!known.has(token)) found.add(token);
  }
  return [...found];
}

export function variablesByGroup(group: VariableGroup) {
  return TEMPLATE_VARIABLES.filter((variable) => variable.group === group);
}
