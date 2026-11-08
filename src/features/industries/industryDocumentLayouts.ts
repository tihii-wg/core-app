/**
 * Per-industry / per-role default canvas layouts for print templates.
 * Title comes from the document spec name — never a hard-coded "ЗАКАЗ-НАРЯД".
 */

import type { TFunction } from "i18next";
import i18n from "../../i18n";
import { themeRef } from "../documents/colorRef";
import type { DocumentTemplateType, TableColumn, TableSource, TotalsRow } from "../documents/layout";
import { estimateTotalsHeightMm } from "../documents/canvas/tableData";
import {
  newCanvasElementId,
  type CanvasDocumentLayout,
  type CanvasElement,
  type CanvasElementStyle,
} from "../documents/canvas/types";
import type { IndustryAssetKind, IndustryDocumentRole, IndustryDocumentSpec, IndustryProfile } from "./industryProfile";

type Translate = TFunction;

function tDefault(t: Translate | undefined): Translate {
  return t ?? (i18n.t.bind(i18n) as Translate);
}

function L(t: Translate, key: string): string {
  return String(t(`settings.printTemplates.canvas.defaults.${key}` as "settings.printTemplates.canvas.defaults.client"));
}

function baseStyle(overrides: Partial<CanvasElementStyle> = {}): CanvasElementStyle {
  return {
    fontSizePt: 10,
    color: themeRef("text"),
    align: "left",
    paddingMm: 1,
    ...overrides,
  };
}

function col(
  key: TableColumn["key"],
  label: string,
  enabled = true,
  widthPercent?: number,
  align?: "left" | "center" | "right",
): TableColumn & { align?: "left" | "center" | "right" } {
  return { key, label, enabled, widthPercent, align };
}

function total(key: TotalsRow["key"], label: string, enabled = true): TotalsRow {
  return { key, label, enabled };
}

function page(): CanvasDocumentLayout["page"] {
  return { size: "A4", orientation: "portrait", marginsMm: 10 };
}

function headerBand(titleLine: string, numberToken: string): CanvasElement[] {
  const titleContent = numberToken.trim() ? `${titleLine}\n${numberToken}` : titleLine;
  return [
    {
      id: newCanvasElementId("rect"),
      type: "rect",
      xMm: 0,
      yMm: 0,
      wMm: 190,
      hMm: 28,
      zIndex: 0,
      style: baseStyle({ paddingMm: 0, color: "#ffffff" }),
      fill: { color: themeRef("primary") },
    },
    {
      id: newCanvasElementId("logo"),
      type: "image",
      xMm: 4,
      yMm: 4,
      wMm: 20,
      hMm: 20,
      zIndex: 2,
      source: "logo",
      objectFit: "contain",
      style: baseStyle({ paddingMm: 0, color: "#ffffff" }),
    },
    {
      id: newCanvasElementId("co"),
      type: "text",
      xMm: 28,
      yMm: 4,
      wMm: 90,
      hMm: 20,
      zIndex: 2,
      content: "#КОМПАНИЯ-НАЗВАНИЕ\n#КОМПАНИЯ-ТЕЛЕФОН",
      style: baseStyle({ fontSizePt: 11, bold: true, color: "#ffffff", paddingMm: 1, verticalAlign: "middle" }),
    },
    {
      id: newCanvasElementId("title"),
      type: "text",
      xMm: 120,
      yMm: 4,
      wMm: 66,
      hMm: 20,
      zIndex: 2,
      content: titleContent,
      style: baseStyle({
        fontSizePt: 13,
        bold: true,
        color: "#ffffff",
        align: "right",
        paddingMm: 1,
        verticalAlign: "middle",
      }),
    },
  ];
}

function tintBox(xMm: number, yMm: number, wMm: number, hMm: number, content: string, title: string): CanvasElement[] {
  return [
    {
      id: newCanvasElementId("box"),
      type: "rect",
      xMm,
      yMm,
      wMm,
      hMm,
      zIndex: 0,
      style: baseStyle({ paddingMm: 0, color: themeRef("text") }),
      fill: { color: themeRef("tint") },
      radiusMm: 2,
    },
    {
      id: newCanvasElementId("boxt"),
      type: "text",
      xMm: xMm + 2,
      yMm: yMm + 2,
      wMm: wMm - 4,
      hMm: hMm - 4,
      zIndex: 1,
      content: `${title}\n${content}`,
      style: baseStyle({ fontSizePt: 9, color: themeRef("text"), paddingMm: 1, lineHeight: 1.35 }),
    },
  ];
}

function lineColumns(t: Translate) {
  return [
    col("index", "№", true, 6, "center"),
    col("name", L(t, "name"), true, 44, "left"),
    col("qty", L(t, "qty"), true, 10, "right"),
    col("price", L(t, "price"), true, 18, "right"),
    col("sum", L(t, "sum"), true, 22, "right"),
  ];
}

function tableElement(
  yMm: number,
  source: TableSource,
  columns: ReturnType<typeof lineColumns>,
): CanvasElement {
  return {
    id: newCanvasElementId("tbl"),
    type: "table",
    xMm: 0,
    yMm,
    wMm: 190,
    hMm: 40,
    zIndex: 1,
    source,
    columns,
    showTotalsRow: true,
    headerBackground: themeRef("primary"),
    headerTextColor: "#ffffff",
    rowBackground: "#ffffff",
    zebraBackground: themeRef("tint"),
    borderColor: themeRef("border"),
    totalsRowBackground: themeRef("tint"),
    totalsRowTextColor: themeRef("primaryDark"),
    borders: "horizontal",
    style: baseStyle({ fontSizePt: 9, paddingMm: 0 }),
  };
}

function defaultTotalsRows(t: Translate): TotalsRow[] {
  return [
    total("servicesSum", L(t, "services")),
    total("materialsSum", L(t, "materials")),
    total("discount", L(t, "discount")),
    total("net", L(t, "net")),
    total("vat", L(t, "vat")),
    total("total", L(t, "total")),
  ];
}

function totalsElement(yMm: number, t: Translate, rows?: TotalsRow[]): CanvasElement {
  const resolved = rows ?? defaultTotalsRows(t);
  return {
    id: newCanvasElementId("tot"),
    type: "totals",
    xMm: 100,
    yMm,
    wMm: 90,
    hMm: estimateTotalsHeightMm(0, 0, resolved),
    zIndex: 1,
    rows: resolved,
    background: themeRef("tint"),
    textColor: themeRef("text"),
    grandTotalBackground: themeRef("primary"),
    grandTotalTextColor: "#ffffff",
    style: baseStyle({ fontSizePt: 10, paddingMm: 2 }),
  };
}

function signaturesElement(yMm: number, t: Translate): CanvasElement {
  return {
    id: newCanvasElementId("sig"),
    type: "signatures",
    xMm: 0,
    yMm,
    wMm: 190,
    hMm: 36,
    zIndex: 1,
    labels: [L(t, "executor"), L(t, "customer")],
    style: baseStyle({ fontSizePt: 9, paddingMm: 1 }),
  };
}

function layoutLabel(t: Translate, key: string, fallback: string): string {
  return String(t(`industries.layout.${key}` as never, { defaultValue: fallback }));
}

function invoicePartyBlocks(t: Translate): CanvasElement[] {
  return [
    ...tintBox(
      0,
      34,
      92,
      48,
      `${L(t, "invoiceDate")}: #СЧЁТ-ДАТА\n${L(t, "payBy")}: #СЧЁТ-СРОК-ОПЛАТЫ\n#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-АДРЕС\n#КЛИЕНТ-IDNO`,
      L(t, "billTo"),
    ),
    ...tintBox(
      98,
      34,
      92,
      48,
      `#КОМПАНИЯ-НАЗВАНИЕ\n${L(t, "registrationNo")}: #КОМПАНИЯ-РЕГИСТРАЦИЯ\n${L(t, "taxId")}: #КОМПАНИЯ-IDNO\nIBAN: #КОМПАНИЯ-IBAN\n${L(t, "bank")}: #КОМПАНИЯ-БАНК`,
      L(t, "seller"),
    ),
  ];
}

function tableCaption(yMm: number, text: string): CanvasElement {
  return {
    id: newCanvasElementId("cap"),
    type: "text",
    xMm: 0,
    yMm,
    wMm: 190,
    hMm: 7,
    zIndex: 1,
    content: text,
    style: baseStyle({ fontSizePt: 10, bold: true, paddingMm: 0 }),
  };
}

function numberTokenFor(documentType: DocumentTemplateType): string {
  if (documentType === "invoice") return "#СЧЁТ-НОМЕР";
  return "#ЗАКАЗ-НОМЕР";
}

/** Right-hand (or full-width) asset box content based on industry asset kind. */
export function assetBlockContent(assetKind: IndustryAssetKind): { titleKey: string; content: string } | null {
  if (assetKind === "vehicle") {
    return {
      titleKey: "vehicle",
      content: "#АВТО-МАРКА #АВТО-МОДЕЛЬ\n#АВТО-НОМЕР\nVIN: #АВТО-VIN\n#АВТО-ПРОБЕГ",
    };
  }
  if (assetKind === "device") {
    return {
      titleKey: "device",
      content:
        "#УСТРОЙСТВО\n#УСТРОЙСТВО-СЕРИЙНЫЙ\n#УСТРОЙСТВО-IMEI\n#УСТРОЙСТВО-СОСТОЯНИЕ\n#УСТРОЙСТВО-КОМПЛЕКТНОСТЬ",
    };
  }
  if (assetKind === "site" || assetKind === "project") {
    return {
      titleKey: "object",
      content: "#ОБЪЕКТ-АДРЕС\n#ЗАКАЗ-ОПИСАНИЕ",
    };
  }
  return null;
}

function clientAssetRow(
  t: Translate,
  assetKind: IndustryAssetKind,
): { left: CanvasElement[]; right: CanvasElement[] | null; full?: CanvasElement[] } {
  const clientBox = tintBox(0, 34, assetKind === "none" ? 190 : 92, 40, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-ТЕЛЕФОН\n#КЛИЕНТ-АДРЕС", L(t, "client"));
  const asset = assetBlockContent(assetKind);
  if (!asset) {
    return { left: clientBox, right: null };
  }
  const title =
    asset.titleKey === "vehicle"
      ? L(t, "vehicle")
      : asset.titleKey === "device"
        ? String(t("industries.layout.device" as never, { defaultValue: "Device" }))
        : String(t("industries.layout.object" as never, { defaultValue: "Object" }));
  return {
    left: tintBox(0, 34, 92, 40, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-ТЕЛЕФОН\n#КЛИЕНТ-АДРЕС", L(t, "client")),
    right: tintBox(98, 34, 92, 40, asset.content, title),
  };
}

function baseWorkOrderLike(
  title: string,
  documentType: DocumentTemplateType,
  assetKind: IndustryAssetKind,
  t: Translate,
  tableSource: "allLines" | "services" | "materials" = "allLines",
  extraAfterTable: CanvasElement[] = [],
): CanvasDocumentLayout {
  const row = clientAssetRow(t, assetKind);
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, numberTokenFor(documentType)),
      ...row.left,
      ...(row.right ?? []),
      tableElement(84, tableSource, lineColumns(t)),
      totalsElement(136, t),
      ...extraAfterTable,
      signaturesElement(190, t),
    ],
  };
}

function furnitureContract(title: string, t: Translate): CanvasDocumentLayout {
  const contractTitle = `${title} № #ЗАКАЗ-НОМЕР от #ЗАКАЗ-ДАТА`;
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(contractTitle, ""),
      {
        id: newCanvasElementId("city"),
        type: "text",
        xMm: 0,
        yMm: 30,
        wMm: 190,
        hMm: 6,
        zIndex: 1,
        content: layoutLabel(t, "cityLine", "г. #КОМПАНИЯ-АДРЕС"),
        style: baseStyle({ fontSizePt: 9, align: "center", paddingMm: 0 }),
      },
      ...tintBox(0, 40, 92, 36, "#КОМПАНИЯ-НАЗВАНИЕ\n#КОМПАНИЯ-IDNO\n#КОМПАНИЯ-АДРЕС\n#КОМПАНИЯ-ТЕЛЕФОН", layoutLabel(t, "seller", "Seller")),
      ...tintBox(98, 40, 92, 36, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-IDNO\n#КЛИЕНТ-АДРЕС\n#КЛИЕНТ-ТЕЛЕФОН", layoutLabel(t, "buyer", "Buyer")),
      ...tintBox(
        0,
        82,
        190,
        28,
        "#ЗАКАЗ-ОПИСАНИЕ\n#ОБЪЕКТ-АДРЕС\n#ИЗДЕЛИЕ-РАЗМЕРЫ\n#ДАТА-МОНТАЖА",
        layoutLabel(t, "subject", "Subject"),
      ),
      totalsElement(118, t, [
        total("total", L(t, "total")),
        total("paid", layoutLabel(t, "prepayment", "Prepayment")),
        total("remaining", layoutLabel(t, "balance", "Balance")),
      ]),
      ...tintBox(0, 152, 190, 40, "#ГРАФИК-ОПЛАТ", layoutLabel(t, "paymentSchedule", "Payment schedule")),
      ...tintBox(0, 196, 190, 24, layoutLabel(t, "contractTerms", "Delivery / installation per order. Warranty: 12 months."), layoutLabel(t, "terms", "Terms")),
      signaturesElement(226, t),
    ],
  };
}

function furnitureSpecification(title: string, t: Translate): CanvasDocumentLayout {
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, "#ЗАКАЗ-НОМЕР"),
      ...tintBox(
        0,
        34,
        190,
        24,
        "#ЗАКАЗ-ОПИСАНИЕ\n#ОБЪЕКТ-АДРЕС\n#ИЗДЕЛИЕ-РАЗМЕРЫ\n#ДАТА-МОНТАЖА",
        layoutLabel(t, "product", "Product"),
      ),
      tableCaption(62, layoutLabel(t, "materialsCaption", "Materials & hardware")),
      tableElement(70, "materials", lineColumns(t)),
      tableCaption(122, layoutLabel(t, "worksCaption", "Works")),
      tableElement(130, "services", lineColumns(t)),
      totalsElement(182, t),
      signaturesElement(235, t),
    ],
  };
}

function furniturePrepaymentInvoice(title: string, t: Translate): CanvasDocumentLayout {
  const dueLabel = layoutLabel(t, "prepaymentDue", "Amount due (#ЭТАП-ТЕКУЩИЙ-СУММА)");
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, "#СЧЁТ-НОМЕР"),
      ...invoicePartyBlocks(t),
      tableElement(90, "prepaymentLine", lineColumns(t)),
      totalsElement(136, t, [
        total("total", layoutLabel(t, "contractTotal", "Contract total")),
        total("paid", dueLabel),
        total("paidWords", L(t, "inWords")),
      ]),
      signaturesElement(192, t),
    ],
  };
}

function furnitureBalanceInvoice(title: string, t: Translate): CanvasDocumentLayout {
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, "#СЧЁТ-НОМЕР"),
      ...invoicePartyBlocks(t),
      tableElement(90, "balanceLine", lineColumns(t)),
      totalsElement(136, t, [
        total("total", L(t, "total")),
        total("paid", layoutLabel(t, "paid", "Paid")),
        total("remaining", layoutLabel(t, "balanceDue", "Amount due")),
        total("remainingWords", L(t, "inWords")),
      ]),
      signaturesElement(200, t),
    ],
  };
}

function furnitureAcceptanceAct(title: string, t: Translate): CanvasDocumentLayout {
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, "#ЗАКАЗ-НОМЕР"),
      ...tintBox(0, 34, 92, 32, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-ТЕЛЕФОН\n#КЛИЕНТ-АДРЕС", L(t, "client")),
      ...tintBox(
        98,
        34,
        92,
        32,
        "#ЗАКАЗ-ОПИСАНИЕ\n#ОБЪЕКТ-АДРЕС\n#ИЗДЕЛИЕ-РАЗМЕРЫ\n#ДАТА-МОНТАЖА",
        layoutLabel(t, "object", "Object"),
      ),
      tableCaption(70, layoutLabel(t, "worksCaption", "Works")),
      tableElement(78, "services", lineColumns(t)),
      tableCaption(124, layoutLabel(t, "materialsCaption", "Materials & hardware")),
      tableElement(132, "materials", lineColumns(t)),
      totalsElement(178, t),
      ...tintBox(0, 222, 190, 16, layoutLabel(t, "noClaims", "The Customer has no claims regarding the quality or completeness of the works."), layoutLabel(t, "acceptance", "Acceptance")),
      signaturesElement(240, t),
    ],
  };
}

function deviceReceipt(title: string, assetKind: IndustryAssetKind, t: Translate): CanvasDocumentLayout {
  return baseWorkOrderLike(title, "work_order", assetKind, t, "allLines");
}

function deviceWarrantyCard(title: string, assetKind: IndustryAssetKind, t: Translate): CanvasDocumentLayout {
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, "#ЗАКАЗ-НОМЕР"),
      ...clientAssetRow(t, assetKind).left,
      ...(clientAssetRow(t, assetKind).right ?? []),
      ...tintBox(0, 84, 190, 36, "#ГАРАНТИЯ-СПИСОК", String(t("industries.layout.warranty" as never, { defaultValue: "Warranty" }))),
      signaturesElement(140, t),
    ],
  };
}

/**
 * Builds the default canvas layout for one industry document spec.
 * The visible title is always `documentTitle` (translated spec name).
 */
export function defaultCanvasLayoutForIndustryDocument(
  spec: IndustryDocumentSpec,
  profile: IndustryProfile,
  documentTitle: string,
  t?: Translate,
): CanvasDocumentLayout {
  const translate = tDefault(t);
  const title = documentTitle.trim() || String(i18n.t(spec.nameKey as never, { defaultValue: spec.role }));
  const assetKind = profile.assetKind;
  const role: IndustryDocumentRole = spec.role;

  if (profile.slug === "furniture_manufacturing" || profile.demoPack === "furniture") {
    if (role === "contract") return furnitureContract(title, translate);
    if (role === "specification") return furnitureSpecification(title, translate);
    if (role === "prepayment_invoice") return furniturePrepaymentInvoice(title, translate);
    if (role === "balance_invoice") return furnitureBalanceInvoice(title, translate);
    if (role === "act") return furnitureAcceptanceAct(title, translate);
  }

  if (role === "warranty_card") return deviceWarrantyCard(title, assetKind, translate);
  if (role === "receipt" || role === "job_ticket" || role === "work_order") {
    return deviceReceipt(title, assetKind, translate);
  }
  if (role === "act") {
    const row = clientAssetRow(translate, assetKind);
    return {
      version: 3,
      mode: "canvas",
      useStyle: true,
      page: page(),
      gridMm: 2,
      elements: [
        ...headerBand(title, "#ЗАКАЗ-НОМЕР"),
        ...row.left,
        ...(row.right ?? []),
        tableElement(84, "allLines", lineColumns(translate)),
        totalsElement(136, translate),
        signaturesElement(190, translate),
      ],
    };
  }
  if (role === "invoice" || role === "prepayment_invoice" || role === "balance_invoice") {
    return {
      version: 3,
      mode: "canvas",
      useStyle: true,
      page: page(),
      gridMm: 2,
      elements: [
        ...headerBand(title, "#СЧЁТ-НОМЕР"),
        ...invoicePartyBlocks(translate),
        tableElement(90, "invoiceLines", lineColumns(translate)),
        totalsElement(150, translate, [
          total("net", L(translate, "net")),
          total("vat", L(translate, "vat")),
          total("total", L(translate, "totalDue")),
          total("totalWords", L(translate, "inWords")),
        ]),
        signaturesElement(205, translate),
      ],
    };
  }

  return baseWorkOrderLike(title, spec.documentType, assetKind, translate);
}

/** True when a serialized layout includes the vehicle make/mileage block (not device serial reuse). */
export function layoutIncludesVehicleBlock(layout: CanvasDocumentLayout): boolean {
  return layout.elements.some(
    (el) =>
      el.type === "text" &&
      typeof el.content === "string" &&
      (el.content.includes("#АВТО-МАРКА") || el.content.includes("#АВТО-ПРОБЕГ")),
  );
}
