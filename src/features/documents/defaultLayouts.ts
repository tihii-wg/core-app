/** Sensible Moldova-style default layouts for work order, act, and invoice. */

import { themeRef } from "./colorRef";
import {
  newBlockId,
  type DocumentLayout,
  type DocumentTemplateType,
  type FieldRef,
  type TableColumn,
  type TotalsRow,
} from "./layout";

function field(token: string, label: string, enabled = true): FieldRef {
  return { token, label, enabled, hideIfEmpty: true };
}

function fieldTpl(label: string, template: string, enabled = true): FieldRef {
  return { label, template, enabled, hideIfEmpty: true };
}

function col(key: TableColumn["key"], label: string, enabled = true, widthPercent?: number): TableColumn {
  return { key, label, enabled, widthPercent };
}

function total(key: TotalsRow["key"], label: string, enabled = true): TotalsRow {
  return { key, label, enabled };
}

const orderClientFields: FieldRef[] = [
  field("#КЛИЕНТ-ИМЯ", "Client"),
  field("#КЛИЕНТ-ТЕЛЕФОН", "Phone"),
  field("#КЛИЕНТ-АДРЕС", "Address"),
  field("#КЛИЕНТ-IDNO", "IDNO"),
];

const vehicleFields: FieldRef[] = [
  field("#АВТО-МАРКА", "Make"),
  field("#АВТО-МОДЕЛЬ", "Model"),
  field("#АВТО-ГОД", "Year"),
  field("#АВТО-НОМЕР", "Plate"),
  field("#АВТО-VIN", "VIN"),
  field("#АВТО-ПРОБЕГ", "Mileage"),
];

const lineColumns: TableColumn[] = [
  col("index", "№", true, 5),
  col("name", "Name", true, 40),
  col("sku", "SKU", false, 10),
  col("qty", "Qty", true, 8),
  col("unit", "Unit", false, 8),
  col("price", "Price", true, 12),
  col("discount", "Discount", true, 10),
  col("vat", "VAT", false, 10),
  col("sum", "Sum", true, 12),
  col("warranty", "Warranty", false, 10),
  col("performer", "Performer", false, 12),
];

const invoiceLineColumns: TableColumn[] = [
  col("index", "№", true, 6),
  col("name", "Description", true, 46),
  col("qty", "Qty", true, 12),
  col("price", "Unit price", true, 18),
  col("sum", "Total", true, 18),
];

function pageDefaults(): DocumentLayout["page"] {
  return { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 };
}

function styleHeaderBlock(): DocumentLayout["blocks"][number] {
  return { id: newBlockId("sh"), kind: "styleHeader", enabled: true };
}

function styleFooterBlock(): DocumentLayout["blocks"][number] {
  return { id: newBlockId("sf"), kind: "styleFooter", enabled: true };
}

export function defaultWorkOrderLayout(): DocumentLayout {
  return {
    version: 2,
    useStyle: true,
    page: pageDefaults(),
    blocks: [
      styleHeaderBlock(),
      {
        id: newBlockId("cli"),
        kind: "fields",
        enabled: true,
        title: "Client",
        style: { titleColor: themeRef("primary"), border: "box", padding: "sm" },
        fields: orderClientFields,
      },
      {
        id: newBlockId("veh"),
        kind: "fields",
        enabled: true,
        title: "Vehicle",
        style: { titleColor: themeRef("primary"), border: "box", padding: "sm" },
        fields: vehicleFields,
      },
      {
        id: newBlockId("ord"),
        kind: "fields",
        enabled: true,
        title: "Order",
        style: { titleColor: themeRef("primary") },
        fields: [
          field("#СТАТУС", "Status"),
          field("#ЗАКАЗ-ОПИСАНИЕ", "Description"),
          field("#ЗАКАЗ-ПРОБЕГ", "Mileage"),
          field("#ИСПОЛНИТЕЛЬ", "Assignee"),
        ],
      },
      {
        id: newBlockId("svc"),
        kind: "table",
        enabled: true,
        title: "Services",
        source: "services",
        style: { titleColor: themeRef("primaryDark") },
        columns: lineColumns,
        showTotalsRow: true,
      },
      {
        id: newBlockId("mat"),
        kind: "table",
        enabled: true,
        title: "Materials",
        source: "materials",
        style: { titleColor: themeRef("primaryDark") },
        columns: lineColumns.map((column) => ({ ...column })),
        showTotalsRow: true,
      },
      {
        id: newBlockId("tot"),
        kind: "totals",
        enabled: true,
        style: { align: "right" },
        rows: [
          total("servicesSum", "Services"),
          total("materialsSum", "Materials"),
          total("discount", "Discount"),
          total("total", "Total"),
          total("paid", "Paid"),
          total("remaining", "Remaining"),
          total("totalWords", "In words"),
        ],
      },
      { id: newBlockId("war"), kind: "warranty", enabled: true, title: "Warranty" },
      {
        id: newBlockId("sig"),
        kind: "signatures",
        enabled: true,
        labels: ["Исполнитель", "Заказчик"],
      },
      styleFooterBlock(),
    ],
  };
}

export function defaultActLayout(): DocumentLayout {
  return {
    version: 2,
    useStyle: true,
    page: pageDefaults(),
    blocks: [
      styleHeaderBlock(),
      {
        id: newBlockId("cli"),
        kind: "fields",
        enabled: true,
        title: "Client",
        style: { titleColor: themeRef("primary"), border: "box", padding: "sm" },
        fields: orderClientFields,
      },
      {
        id: newBlockId("veh"),
        kind: "fields",
        enabled: true,
        title: "Vehicle",
        style: { titleColor: themeRef("primary"), border: "box", padding: "sm" },
        fields: vehicleFields,
      },
      {
        id: newBlockId("lines"),
        kind: "table",
        enabled: true,
        title: "Works and materials",
        source: "allLines",
        style: { titleColor: themeRef("primaryDark") },
        columns: lineColumns,
        showTotalsRow: true,
      },
      {
        id: newBlockId("tot"),
        kind: "totals",
        enabled: true,
        style: { align: "right" },
        rows: [
          total("total", "Total"),
          total("vat", "VAT"),
          total("totalWords", "In words"),
          total("paid", "Paid"),
          total("remaining", "Remaining"),
        ],
      },
      {
        id: newBlockId("txt"),
        kind: "text",
        enabled: true,
        html: "<p>Работы выполнены в полном объёме. Претензий по качеству не имею.</p>",
      },
      {
        id: newBlockId("sig"),
        kind: "signatures",
        enabled: true,
        labels: ["Исполнитель", "Заказчик"],
      },
      styleFooterBlock(),
    ],
  };
}

/**
 * Invoice content layout (header/footer live in DocumentStyle).
 * Colors use theme:* refs so the shared style drives the look.
 */
export function defaultInvoiceLayout(): DocumentLayout {
  return {
    version: 2,
    useStyle: true,
    page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
    blocks: [
      { id: "inv_style_header", kind: "styleHeader", enabled: true },
      // Info grid
      {
        id: "inv_meta",
        kind: "columns",
        enabled: true,
        gapMm: 2,
        columns: [
          {
            id: "inv_meta_issue",
            widthPercent: 25,
            blocks: [
              {
                id: "inv_issue",
                kind: "fields",
                enabled: true,
                style: { background: themeRef("tint"), padding: "sm", border: "none" },
                fields: [fieldTpl("Issue date", "#СЧЁТ-ДАТА")],
              },
            ],
          },
          {
            id: "inv_meta_due",
            widthPercent: 25,
            blocks: [
              {
                id: "inv_due",
                kind: "fields",
                enabled: true,
                style: { background: themeRef("tint"), padding: "sm" },
                fields: [fieldTpl("Due date", "#СЧЁТ-СРОК-ОПЛАТЫ")],
              },
            ],
          },
          {
            id: "inv_meta_order",
            widthPercent: 25,
            blocks: [
              {
                id: "inv_order",
                kind: "fields",
                enabled: true,
                style: { background: themeRef("tint"), padding: "sm" },
                fields: [fieldTpl("Order", "#СЧЁТ-ЗАКАЗ")],
              },
            ],
          },
          {
            id: "inv_meta_paid",
            widthPercent: 25,
            blocks: [
              {
                id: "inv_paid",
                kind: "fields",
                enabled: true,
                style: { background: themeRef("tint"), padding: "sm" },
                fields: [fieldTpl("Paid on", "#СЧЁТ-ОПЛАЧЕН")],
              },
            ],
          },
        ],
      },
      // Supplier | Customer
      {
        id: "inv_parties",
        kind: "columns",
        enabled: true,
        gapMm: 3,
        columns: [
          {
            id: "inv_supplier_col",
            widthPercent: 50,
            blocks: [
              {
                id: "inv_supplier",
                kind: "fields",
                enabled: true,
                title: "Supplier",
                style: {
                  border: "box",
                  padding: "sm",
                  titleColor: themeRef("primary"),
                  color: themeRef("text"),
                },
                fields: [
                  fieldTpl("", "#КОМПАНИЯ-НАЗВАНИЕ"),
                  fieldTpl("Address", "#КОМПАНИЯ-АДРЕС"),
                  fieldTpl("Reg. No.", "#КОМПАНИЯ-РЕГИСТРАЦИЯ"),
                  fieldTpl("Fiscal code (IDNO)", "#КОМПАНИЯ-IDNO"),
                  fieldTpl("Email", "#КОМПАНИЯ-EMAIL"),
                ],
              },
            ],
          },
          {
            id: "inv_customer_col",
            widthPercent: 50,
            blocks: [
              {
                id: "inv_customer",
                kind: "fields",
                enabled: true,
                title: "Customer",
                style: {
                  border: "box",
                  padding: "sm",
                  titleColor: themeRef("primary"),
                  color: themeRef("text"),
                },
                fields: [
                  fieldTpl("", "#ПОКУПАТЕЛЬ-ИМЯ"),
                  fieldTpl("Phone", "#ПОКУПАТЕЛЬ-ТЕЛЕФОН"),
                  fieldTpl("Device", "#СЧЁТ-УСТРОЙСТВО"),
                  fieldTpl("Car number", "#СЧЁТ-НОМЕР-АВТО"),
                  fieldTpl("VIN", "#СЧЁТ-VIN"),
                ],
              },
            ],
          },
        ],
      },
      {
        id: "inv_notes",
        kind: "fields",
        enabled: true,
        title: "Notes",
        style: { titleColor: themeRef("primary") },
        fields: [fieldTpl("", "#СЧЁТ-ОПИСАНИЕ")],
      },
      {
        id: "inv_works",
        kind: "table",
        enabled: true,
        title: "Works",
        source: "invoiceWorks",
        style: { titleColor: themeRef("primaryDark") },
        columns: invoiceLineColumns,
        showTotalsRow: true,
      },
      {
        id: "inv_materials",
        kind: "table",
        enabled: true,
        title: "Materials",
        source: "invoiceMaterials",
        style: { titleColor: themeRef("primaryDark") },
        columns: invoiceLineColumns.map((column) => ({ ...column })),
        showTotalsRow: true,
      },
      {
        id: "inv_totals",
        kind: "totals",
        enabled: true,
        style: {
          align: "right",
          background: themeRef("primary"),
          color: "#ffffff",
          padding: "sm",
        },
        rows: [
          total("servicesSum", "Works subtotal"),
          total("materialsSum", "Materials subtotal"),
          total("remaining", "Amount due"),
          total("total", "Total"),
        ],
      },
      {
        id: "inv_payment",
        kind: "fields",
        enabled: true,
        title: "Payment details",
        style: {
          background: themeRef("tint"),
          padding: "sm",
          titleColor: themeRef("primaryDark"),
          color: themeRef("muted"),
        },
        fields: [
          fieldTpl("IBAN", "#КОМПАНИЯ-IBAN"),
          fieldTpl("Bank", "#КОМПАНИЯ-БАНК"),
          fieldTpl("Bank code", "#КОМПАНИЯ-БИК"),
          fieldTpl("Beneficiary", "#КОМПАНИЯ-НАЗВАНИЕ"),
          fieldTpl("", "#КОМПАНИЯ-ДОПИНФО"),
        ],
      },
      { id: "inv_style_footer", kind: "styleFooter", enabled: true },
    ],
  };
}

/** Section markers used by tests to assert order matches InvoicePrintDocument content. */
export const DEFAULT_INVOICE_SECTION_ORDER = [
  "inv_style_header",
  "inv_meta",
  "inv_parties",
  "inv_notes",
  "inv_works",
  "inv_materials",
  "inv_totals",
  "inv_payment",
  "inv_style_footer",
] as const;

export function defaultLayoutForType(documentType: DocumentTemplateType): DocumentLayout {
  if (documentType === "act") return defaultActLayout();
  if (documentType === "invoice") return defaultInvoiceLayout();
  return defaultWorkOrderLayout();
}

export function defaultTemplateName(documentType: DocumentTemplateType): string {
  if (documentType === "act") return "Акт выполненных работ";
  if (documentType === "invoice") return "Standard invoice";
  return "Заказ-наряд";
}
