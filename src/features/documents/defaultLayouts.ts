/** Sensible Moldova-style default layouts for work order, act, and invoice. */

import {
  newBlockId,
  type DocumentLayout,
  type DocumentTemplateType,
  type FieldRef,
  type TableColumn,
  type TotalsRow,
} from "./layout";

function field(token: string, label: string, enabled = true): FieldRef {
  return { token, label, enabled };
}

function col(key: TableColumn["key"], label: string, enabled = true, widthPercent?: number): TableColumn {
  return { key, label, enabled, widthPercent };
}

function total(key: TotalsRow["key"], label: string, enabled = true): TotalsRow {
  return { key, label, enabled };
}

const companyFields: FieldRef[] = [
  field("#КОМПАНИЯ-ЛОГОТИП", "Logo"),
  field("#КОМПАНИЯ-НАЗВАНИЕ", "Company"),
  field("#КОМПАНИЯ-АДРЕС", "Address"),
  field("#КОМПАНИЯ-EMAIL", "Email"),
  field("#КОМПАНИЯ-IDNO", "IDNO"),
  field("#КОМПАНИЯ-IBAN", "IBAN"),
  field("#КОМПАНИЯ-БАНК", "Bank"),
];

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
];

const invoiceColumns: TableColumn[] = [
  col("index", "№", true, 5),
  col("name", "Name", true, 45),
  col("qty", "Qty", true, 10),
  col("price", "Price", true, 15),
  col("vat", "VAT", true, 12),
  col("sum", "Sum", true, 13),
];

function pageDefaults(): DocumentLayout["page"] {
  return { size: "A4", orientation: "portrait", marginsMm: 12, fontSizePt: 10 };
}

export function defaultWorkOrderLayout(): DocumentLayout {
  return {
    version: 1,
    page: pageDefaults(),
    blocks: [
      {
        id: newBlockId("hdr"),
        kind: "companyHeader",
        enabled: true,
        fields: companyFields,
        align: "left",
      },
      {
        id: newBlockId("ttl"),
        kind: "documentTitle",
        enabled: true,
        text: "Заказ-наряд № #ЗАКАЗ-НОМЕР от #ЗАКАЗ-ДАТА",
      },
      {
        id: newBlockId("cli"),
        kind: "fields",
        enabled: true,
        title: "Client",
        fields: orderClientFields,
      },
      {
        id: newBlockId("veh"),
        kind: "fields",
        enabled: true,
        title: "Vehicle",
        fields: vehicleFields,
      },
      {
        id: newBlockId("ord"),
        kind: "fields",
        enabled: true,
        title: "Order",
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
        columns: lineColumns,
        showTotalsRow: true,
      },
      {
        id: newBlockId("mat"),
        kind: "table",
        enabled: true,
        title: "Materials",
        source: "materials",
        columns: lineColumns.map((column) => ({ ...column })),
        showTotalsRow: true,
      },
      {
        id: newBlockId("tot"),
        kind: "totals",
        enabled: true,
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
    ],
  };
}

export function defaultActLayout(): DocumentLayout {
  return {
    version: 1,
    page: pageDefaults(),
    blocks: [
      {
        id: newBlockId("hdr"),
        kind: "companyHeader",
        enabled: true,
        fields: companyFields,
        align: "left",
      },
      {
        id: newBlockId("ttl"),
        kind: "documentTitle",
        enabled: true,
        text: "Акт выполненных работ № #ЗАКАЗ-НОМЕР от #ЗАКАЗ-ДАТА",
      },
      {
        id: newBlockId("cli"),
        kind: "fields",
        enabled: true,
        title: "Client",
        fields: orderClientFields,
      },
      {
        id: newBlockId("veh"),
        kind: "fields",
        enabled: true,
        title: "Vehicle",
        fields: vehicleFields,
      },
      {
        id: newBlockId("lines"),
        kind: "table",
        enabled: true,
        title: "Works and materials",
        source: "allLines",
        columns: lineColumns,
        showTotalsRow: true,
      },
      {
        id: newBlockId("tot"),
        kind: "totals",
        enabled: true,
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
    ],
  };
}

export function defaultInvoiceLayout(): DocumentLayout {
  return {
    version: 1,
    page: pageDefaults(),
    blocks: [
      {
        id: newBlockId("hdr"),
        kind: "companyHeader",
        enabled: true,
        fields: companyFields,
        align: "left",
      },
      {
        id: newBlockId("ttl"),
        kind: "documentTitle",
        enabled: true,
        text: "Счёт № #СЧЁТ-НОМЕР от #СЧЁТ-ДАТА",
      },
      {
        id: newBlockId("buyer"),
        kind: "fields",
        enabled: true,
        title: "Buyer",
        fields: [
          field("#ПОКУПАТЕЛЬ-ИМЯ", "Buyer"),
          field("#ПОКУПАТЕЛЬ-ТЕЛЕФОН", "Phone"),
          field("#ПОКУПАТЕЛЬ-EMAIL", "Email"),
          field("#ПОКУПАТЕЛЬ-АДРЕС", "Address"),
          field("#ПОКУПАТЕЛЬ-IDNO", "IDNO"),
        ],
      },
      {
        id: newBlockId("meta"),
        kind: "fields",
        enabled: true,
        title: "Invoice",
        fields: [
          field("#СЧЁТ-СРОК-ОПЛАТЫ", "Due date"),
          field("#ЗАКАЗ-НОМЕР", "Order"),
        ],
      },
      {
        id: newBlockId("lines"),
        kind: "table",
        enabled: true,
        title: "Lines",
        source: "invoiceLines",
        columns: invoiceColumns,
        showTotalsRow: true,
      },
      {
        id: newBlockId("tot"),
        kind: "totals",
        enabled: true,
        rows: [
          total("total", "Total"),
          total("vat", "VAT"),
          total("totalWords", "In words"),
          total("paid", "Paid"),
          total("remaining", "Remaining"),
        ],
      },
      {
        id: newBlockId("sig"),
        kind: "signatures",
        enabled: true,
        labels: ["Исполнитель", "Покупатель"],
      },
    ],
  };
}

export function defaultLayoutForType(documentType: DocumentTemplateType): DocumentLayout {
  if (documentType === "act") return defaultActLayout();
  if (documentType === "invoice") return defaultInvoiceLayout();
  return defaultWorkOrderLayout();
}

export function defaultTemplateName(documentType: DocumentTemplateType): string {
  if (documentType === "act") return "Акт выполненных работ";
  if (documentType === "invoice") return "Счёт";
  return "Заказ-наряд";
}
