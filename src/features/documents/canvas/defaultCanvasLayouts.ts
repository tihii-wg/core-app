/** Default canvas (v3) templates reproducing the original blue invoice/work-order design via theme refs. */

import type { TFunction } from "i18next";
import i18n from "../../../i18n";
import { themeRef } from "../colorRef";
import type { TableColumn, TotalsRow } from "../layout";
import type { DocumentTemplateType } from "../layout";
import { estimateTotalsHeightMm } from "./tableData";
import {
  newCanvasElementId,
  type CanvasDocumentLayout,
  type CanvasElement,
  type CanvasElementStyle,
} from "./types";

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

function col(key: TableColumn["key"], label: string, enabled = true, widthPercent?: number, align?: "left" | "center" | "right"): TableColumn & { align?: "left" | "center" | "right" } {
  return { key, label, enabled, widthPercent, align };
}

function total(key: TotalsRow["key"], label: string, enabled = true): TotalsRow {
  return { key, label, enabled };
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

function invoiceColumns(t: Translate) {
  return [
    col("index", "№", true, 6, "center"),
    col("name", L(t, "description"), true, 46, "left"),
    col("qty", L(t, "qty"), true, 12, "right"),
    col("price", L(t, "unitPrice"), true, 18, "right"),
    col("sum", L(t, "sum"), true, 18, "right"),
  ];
}

function page(): CanvasDocumentLayout["page"] {
  return { size: "A4", orientation: "portrait", marginsMm: 10 };
}

function headerBand(titleToken: string): CanvasElement[] {
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
      content: titleToken,
      style: baseStyle({
        fontSizePt: 14,
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

function tableElement(
  yMm: number,
  source: TableCanvasElementSource,
  columns: TableCanvasElementColumns,
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

type TableCanvasElementSource = import("./types").TableCanvasElement["source"];
type TableCanvasElementColumns = import("./types").TableCanvasElement["columns"];

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
    xMm: 110,
    yMm,
    wMm: 80,
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

export function defaultCanvasWorkOrderLayout(t?: Translate): CanvasDocumentLayout {
  const translate = tDefault(t);
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(`${L(translate, "workOrder")}\n#ЗАКАЗ-НОМЕР`),
      ...tintBox(
        0,
        34,
        92,
        36,
        "#КЛИЕНТ-ИМЯ\n#КЛИЕНТ-ТЕЛЕФОН\n#КЛИЕНТ-АДРЕС",
        L(translate, "client"),
      ),
      ...tintBox(
        98,
        34,
        92,
        36,
        "#АВТО-МАРКА #АВТО-МОДЕЛЬ\n#АВТО-НОМЕР\nVIN: #АВТО-VIN\n#АВТО-ПРОБЕГ",
        L(translate, "vehicle"),
      ),
      tableElement(78, "allLines", lineColumns(translate)),
      totalsElement(130, translate),
      signaturesElement(185, translate),
      {
        id: newCanvasElementId("pn"),
        type: "pageNumber",
        xMm: 150,
        yMm: 265,
        wMm: 40,
        hMm: 8,
        zIndex: 5,
        repeatOnEveryPage: true,
        format: L(translate, "pageNumberFormat"),
        style: baseStyle({ fontSizePt: 8, color: themeRef("muted"), align: "right", paddingMm: 0 }),
      },
    ],
  };
}

export function defaultCanvasActLayout(t?: Translate): CanvasDocumentLayout {
  const translate = tDefault(t);
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(`${L(translate, "act")}\n#ЗАКАЗ-НОМЕР`),
      ...tintBox(
        0,
        34,
        190,
        28,
        "#КЛИЕНТ-ИМЯ · #КЛИЕНТ-ТЕЛЕФОН\n#АВТО-МАРКА #АВТО-МОДЕЛЬ · #АВТО-НОМЕР",
        L(translate, "clientVehicle"),
      ),
      tableElement(70, "services", lineColumns(translate)),
      totalsElement(125, translate),
      signaturesElement(180, translate),
    ],
  };
}

export function defaultCanvasInvoiceLayout(t?: Translate): CanvasDocumentLayout {
  const translate = tDefault(t);
  const invoiceTotals: TotalsRow[] = [
    total("servicesSum", L(translate, "subtotal")),
    total("net", L(translate, "net")),
    total("vat", L(translate, "vat")),
    total("total", L(translate, "totalDue")),
    total("totalWords", L(translate, "inWords")),
  ];
  return {
    version: 3,
    mode: "canvas",
    useStyle: true,
    page: page(),
    gridMm: 2,
    elements: [
      ...headerBand(`${L(translate, "invoice")}\n#СЧЁТ-НОМЕР`),
      ...invoicePartyBlocks(translate),
      tableElement(90, "invoiceLines", invoiceColumns(translate)),
      totalsElement(150, translate, invoiceTotals),
      signaturesElement(205, translate),
    ],
  };
}

export function defaultCanvasEstimateLayout(t?: Translate): CanvasDocumentLayout {
  const translate = tDefault(t);
  const base = defaultCanvasWorkOrderLayout(t);
  return {
    ...base,
    elements: base.elements.map((el) => {
      // The work-order header title («Заказ-наряд\n#ЗАКАЗ-НОМЕР») becomes «Расчёт\n#ЗАКАЗ-НОМЕР».
      if (el.type === "text" && el.content.includes("#ЗАКАЗ-НОМЕР") && el.content.includes(L(translate, "workOrder"))) {
        return { ...el, content: `${L(translate, "estimate")}\n#ЗАКАЗ-НОМЕР` };
      }
      return el;
    }),
  };
}

export function defaultCanvasLayoutForType(documentType: DocumentTemplateType, t?: Translate): CanvasDocumentLayout {
  if (documentType === "act") return defaultCanvasActLayout(t);
  if (documentType === "invoice") return defaultCanvasInvoiceLayout(t);
  if (documentType === "estimate") return defaultCanvasEstimateLayout(t);
  return defaultCanvasWorkOrderLayout(t);
}
