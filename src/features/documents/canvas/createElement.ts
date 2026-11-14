import { themeRef } from "../colorRef";
import type { CanvasElement, CanvasElementStyle, CanvasElementType } from "./types";
import { newCanvasElementId } from "./types";

function style(overrides: Partial<CanvasElementStyle> = {}): CanvasElementStyle {
  return {
    fontSizePt: 10,
    color: themeRef("text"),
    align: "left",
    paddingMm: 1,
    ...overrides,
  };
}

export type PaletteDragPayload =
  | { kind: "element"; elementType: CanvasElementType }
  | { kind: "variable"; token: string; label: string };

/** Default w/h for drop preview (matches createCanvasElementFromPalette). */
export function defaultPaletteElementSizeMm(payload: PaletteDragPayload): { wMm: number; hMm: number } {
  if (payload.kind === "variable") return { wMm: 50, hMm: 8 };
  switch (payload.elementType) {
    case "text":
      return { wMm: 60, hMm: 12 };
    case "variable":
      return { wMm: 50, hMm: 8 };
    case "table":
      return { wMm: 180, hMm: 40 };
    case "totals":
      return { wMm: 70, hMm: 30 };
    case "rect":
      return { wMm: 60, hMm: 20 };
    case "image":
    case "qr":
      return { wMm: 25, hMm: 25 };
    case "line":
      return { wMm: 60, hMm: 2 };
    case "signatures":
      return { wMm: 120, hMm: 28 };
    case "pageNumber":
      return { wMm: 40, hMm: 8 };
    default:
      return { wMm: 40, hMm: 10 };
  }
}

export function createCanvasElementFromPalette(
  payload: PaletteDragPayload,
  xMm: number,
  yMm: number,
): CanvasElement {
  if (payload.kind === "variable") {
    return {
      id: newCanvasElementId("var"),
      type: "variable",
      xMm,
      yMm,
      wMm: 50,
      hMm: 8,
      zIndex: 10,
      token: payload.token,
      label: payload.label,
      labelPosition: "left",
      hideIfEmpty: true,
      style: style({ fontSizePt: 10 }),
    };
  }

  switch (payload.elementType) {
    case "text":
      return {
        id: newCanvasElementId("txt"),
        type: "text",
        xMm,
        yMm,
        wMm: 60,
        hMm: 12,
        zIndex: 10,
        content: "",
        style: style(),
      };
    case "variable":
      return {
        id: newCanvasElementId("var"),
        type: "variable",
        xMm,
        yMm,
        wMm: 50,
        hMm: 8,
        zIndex: 10,
        token: "#ЗАКАЗ-НОМЕР",
        hideIfEmpty: true,
        style: style(),
      };
    case "table":
      return {
        id: newCanvasElementId("tbl"),
        type: "table",
        xMm,
        yMm,
        wMm: 180,
        hMm: 40,
        zIndex: 10,
        source: "allLines",
        columns: [
          { key: "index", label: "№", enabled: true, widthPercent: 8 },
          { key: "name", label: "Name", enabled: true, widthPercent: 50 },
          { key: "qty", label: "Qty", enabled: true, widthPercent: 12 },
          { key: "sum", label: "Sum", enabled: true, widthPercent: 30 },
        ],
        showTotalsRow: true,
        headerBackground: themeRef("primary"),
        headerTextColor: "#ffffff",
        borderColor: themeRef("border"),
        zebraBackground: themeRef("tint"),
        borders: "horizontal",
        style: style({ fontSizePt: 9, paddingMm: 0 }),
      };
    case "totals":
      return {
        id: newCanvasElementId("tot"),
        type: "totals",
        xMm,
        yMm,
        wMm: 70,
        hMm: 30,
        zIndex: 10,
        rows: [
          { key: "servicesSum", label: "Services", enabled: true },
          { key: "total", label: "Total", enabled: true },
        ],
        background: themeRef("tint"),
        grandTotalBackground: themeRef("primary"),
        grandTotalTextColor: "#ffffff",
        style: style(),
      };
    case "rect":
      return {
        id: newCanvasElementId("rect"),
        type: "rect",
        xMm,
        yMm,
        wMm: 60,
        hMm: 20,
        zIndex: 0,
        fill: { color: themeRef("primary") },
        style: style({ paddingMm: 0, color: "#ffffff" }),
      };
    case "image":
      return {
        id: newCanvasElementId("img"),
        type: "image",
        xMm,
        yMm,
        wMm: 25,
        hMm: 25,
        zIndex: 10,
        source: "logo",
        objectFit: "contain",
        style: style({ paddingMm: 0 }),
      };
    case "line":
      return {
        id: newCanvasElementId("ln"),
        type: "line",
        xMm,
        yMm,
        wMm: 60,
        hMm: 2,
        zIndex: 10,
        orientation: "horizontal",
        thicknessPt: 1,
        color: themeRef("border"),
        style: style({ paddingMm: 0 }),
      };
    case "signatures":
      return {
        id: newCanvasElementId("sig"),
        type: "signatures",
        xMm,
        yMm,
        wMm: 120,
        hMm: 28,
        zIndex: 10,
        labels: ["Executor", "Client"],
        dateLabel: "Date",
        style: style({ fontSizePt: 9 }),
      };
    case "qr":
      return {
        id: newCanvasElementId("qr"),
        type: "qr",
        xMm,
        yMm,
        wMm: 25,
        hMm: 25,
        zIndex: 10,
        style: style({ paddingMm: 0 }),
      };
    case "pageNumber":
      return {
        id: newCanvasElementId("pn"),
        type: "pageNumber",
        xMm,
        yMm,
        wMm: 40,
        hMm: 8,
        zIndex: 10,
        repeatOnEveryPage: true,
        format: "Стр. {n} из {m}",
        style: style({ fontSizePt: 8, color: themeRef("muted"), align: "right", paddingMm: 0 }),
      };
  }
}
