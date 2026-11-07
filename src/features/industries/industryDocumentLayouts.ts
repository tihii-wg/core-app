/**
 * Per-industry / per-role default canvas layouts for print templates.
 * Title comes from the document spec name — never a hard-coded "ЗАКАЗ-НАРЯД".
 */

import type { TFunction } from "i18next";
import i18n from "../../i18n";
import { themeRef } from "../documents/colorRef";
import type { DocumentTemplateType, TableColumn, TotalsRow } from "../documents/layout";
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
      content: `${titleLine}\n${numberToken}`,
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
  source: "allLines" | "services" | "materials" | "invoiceLines",
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

function totalsElement(yMm: number, t: Translate, rows?: TotalsRow[]): CanvasElement {
  return {
    id: newCanvasElementId("tot"),
    type: "totals",
    xMm: 110,
    yMm,
    wMm: 80,
    hMm: 40,
    zIndex: 1,
    rows:
      rows ??
      [
        total("servicesSum", L(t, "services")),
        total("materialsSum", L(t, "materials")),
        total("discount", L(t, "discount")),
        total("net", L(t, "net")),
        total("vat", L(t, "vat")),
        total("grossWithVat", L(t, "grossWithVat")),
        total("total", L(t, "total")),
      ],
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
    hMm: 28,
    zIndex: 1,
    labels: [L(t, "executor"), L(t, "customer")],
    dateLabel: L(t, "date"),
    style: baseStyle({ fontSizePt: 9, paddingMm: 1 }),
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
      content: "#УСТРОЙСТВО\n#АВТО-VIN",
    };
  }
  if (assetKind === "site" || assetKind === "project") {
    return {
      titleKey: "object",
      content: "#КЛИЕНТ-АДРЕС\n#ЗАКАЗ-ОПИСАНИЕ",
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
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, "#ЗАКАЗ-НОМЕР"),
      ...tintBox(0, 34, 92, 36, "#КОМПАНИЯ-НАЗВАНИЕ\n#КОМПАНИЯ-IDNO\n#КОМПАНИЯ-АДРЕС\n#КОМПАНИЯ-ТЕЛЕФОН", String(t("industries.layout.seller" as never, { defaultValue: "Seller" }))),
      ...tintBox(98, 34, 92, 36, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-IDNO\n#КЛИЕНТ-АДРЕС\n#КЛИЕНТ-ТЕЛЕФОН", String(t("industries.layout.buyer" as never, { defaultValue: "Buyer" }))),
      ...tintBox(
        0,
        76,
        190,
        28,
        "#ЗАКАЗ-ОПИСАНИЕ",
        String(t("industries.layout.subject" as never, { defaultValue: "Subject" })),
      ),
      totalsElement(112, t, [
        total("total", L(t, "total")),
        total("paid", String(t("industries.layout.prepayment" as never, { defaultValue: "Prepayment" }))),
        total("remaining", String(t("industries.layout.balance" as never, { defaultValue: "Balance" }))),
      ]),
      ...tintBox(
        0,
        160,
        190,
        28,
        String(
          t("industries.layout.contractTerms" as never, {
            defaultValue: "Delivery / installation per order. Warranty: 12 months.",
          }),
        ),
        String(t("industries.layout.terms" as never, { defaultValue: "Terms" })),
      ),
      signaturesElement(200, t),
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
      ...tintBox(0, 34, 190, 24, "#ЗАКАЗ-ОПИСАНИЕ\n#КЛИЕНТ-АДРЕС", String(t("industries.layout.product" as never, { defaultValue: "Product" }))),
      tableElement(66, "materials", lineColumns(t)),
      tableElement(116, "services", lineColumns(t)),
      totalsElement(168, t),
      signaturesElement(220, t),
    ],
  };
}

function furniturePrepaymentInvoice(title: string, t: Translate): CanvasDocumentLayout {
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(title, "#СЧЁТ-НОМЕР"),
      ...tintBox(0, 34, 92, 36, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-АДРЕС\n#КЛИЕНТ-IDNO", L(t, "billTo")),
      ...tintBox(98, 34, 92, 36, "#СЧЁТ-ДАТА\n#СЧЁТ-СРОК-ОПЛАТЫ\n#КОМПАНИЯ-IBAN", L(t, "details")),
      ...tintBox(
        0,
        78,
        190,
        24,
        "#ЗАКАЗ-ОПИСАНИЕ",
        String(t("industries.layout.subject" as never, { defaultValue: "Subject" })),
      ),
      totalsElement(112, t, [
        total("total", L(t, "total")),
        total("paid", String(t("industries.layout.prepayment" as never, { defaultValue: "Prepayment due" }))),
        total("totalWords", L(t, "inWords")),
      ]),
      signaturesElement(170, t),
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
      ...tintBox(0, 34, 92, 36, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-АДРЕС\n#КЛИЕНТ-IDNO", L(t, "billTo")),
      ...tintBox(98, 34, 92, 36, "#СЧЁТ-ДАТА\n#СЧЁТ-СРОК-ОПЛАТЫ\n#КОМПАНИЯ-IBAN", L(t, "details")),
      totalsElement(82, t, [
        total("total", L(t, "total")),
        total("paid", String(t("industries.layout.paid" as never, { defaultValue: "Paid" }))),
        total("remaining", String(t("industries.layout.balanceDue" as never, { defaultValue: "Balance due" }))),
        total("totalWords", L(t, "inWords")),
      ]),
      signaturesElement(150, t),
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
      ...tintBox(98, 34, 92, 32, "#ЗАКАЗ-ОПИСАНИЕ", String(t("industries.layout.object" as never, { defaultValue: "Object" }))),
      tableElement(74, "services", lineColumns(t)),
      totalsElement(126, t),
      ...tintBox(
        0,
        176,
        190,
        18,
        String(
          t("industries.layout.noClaims" as never, {
            defaultValue: "The Customer has no claims regarding the quality or completeness of the works.",
          }),
        ),
        String(t("industries.layout.acceptance" as never, { defaultValue: "Acceptance" })),
      ),
      signaturesElement(204, t),
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
        tableElement(84, "services", lineColumns(translate)),
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
        ...tintBox(0, 34, 92, 40, "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-АДРЕС\n#КЛИЕНТ-IDNO", L(translate, "billTo")),
        ...tintBox(98, 34, 92, 40, "#СЧЁТ-ДАТА\n#СЧЁТ-СРОК-ОПЛАТЫ\n#КОМПАНИЯ-IBAN\n#КОМПАНИЯ-БАНК", L(translate, "details")),
        tableElement(82, "invoiceLines", lineColumns(translate)),
        totalsElement(136, translate, [
          total("net", L(translate, "net")),
          total("vat", L(translate, "vat")),
          total("grossWithVat", L(translate, "grossWithVat")),
          total("total", L(translate, "totalDue")),
          total("totalWords", L(translate, "inWords")),
        ]),
        signaturesElement(195, translate),
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
