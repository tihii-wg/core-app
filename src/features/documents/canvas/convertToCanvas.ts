/** Convert a v1/v2 block layout into a top-to-bottom canvas layout. */

import { themeRef } from "../colorRef";
import type { DocumentLayout, LeafLayoutBlock } from "../layout";
import { flattenLayoutBlocks, migrateLayoutToV2 } from "../layout";
import {
  newCanvasElementId,
  type CanvasDocumentLayout,
  type CanvasElement,
  type CanvasElementStyle,
} from "./types";

function styleBase(overrides: Partial<CanvasElementStyle> = {}): CanvasElementStyle {
  return {
    fontSizePt: 10,
    color: themeRef("text"),
    align: "left",
    paddingMm: 1.5,
    ...overrides,
  };
}

function leafToElements(block: LeafLayoutBlock, yMm: number, widthMm: number): { elements: CanvasElement[]; heightMm: number } {
  if (!block.enabled) return { elements: [], heightMm: 0 };

  switch (block.kind) {
    case "companyHeader": {
      const content = block.fields
        .filter((f) => f.enabled)
        .map((f) => f.template ?? f.token ?? "")
        .filter(Boolean)
        .join("\n");
      return {
        heightMm: 22,
        elements: [
          {
            id: newCanvasElementId("txt"),
            type: "text",
            xMm: 0,
            yMm,
            wMm: widthMm,
            hMm: 22,
            zIndex: 1,
            content: content || "#КОМПАНИЯ-НАЗВАНИЕ",
            style: styleBase({ align: block.align, bold: true, fontSizePt: 12 }),
          },
        ],
      };
    }
    case "documentTitle":
      return {
        heightMm: 14,
        elements: [
          {
            id: newCanvasElementId("txt"),
            type: "text",
            xMm: 0,
            yMm,
            wMm: widthMm,
            hMm: 14,
            zIndex: 1,
            content: block.text,
            style: styleBase({ fontSizePt: 16, bold: true, align: "center", color: themeRef("primary") }),
          },
        ],
      };
    case "fields": {
      const lines = block.fields
        .filter((f) => f.enabled)
        .map((f) => `${f.label}: ${f.template ?? f.token ?? ""}`)
        .join("\n");
      const h = Math.max(18, 6 + block.fields.filter((f) => f.enabled).length * 5);
      return {
        heightMm: h + 4,
        elements: [
          {
            id: newCanvasElementId("box"),
            type: "rect",
            xMm: 0,
            yMm,
            wMm: widthMm,
            hMm: h,
            zIndex: 0,
            fill: block.style?.background ? { color: block.style.background } : { color: themeRef("tint") },
            radiusMm: 2,
            style: styleBase({ paddingMm: 0 }),
          },
          {
            id: newCanvasElementId("txt"),
            type: "text",
            xMm: 2,
            yMm: yMm + 2,
            wMm: widthMm - 4,
            hMm: h - 4,
            zIndex: 1,
            content: block.title ? `${block.title}\n${lines}` : lines,
            style: styleBase({ fontSizePt: 9 }),
          },
        ],
      };
    }
    case "table":
      return {
        heightMm: 45,
        elements: [
          {
            id: newCanvasElementId("tbl"),
            type: "table",
            xMm: 0,
            yMm,
            wMm: widthMm,
            hMm: 40,
            zIndex: 1,
            source: block.source,
            columns: block.columns.map((c) => ({ ...c })),
            showTotalsRow: block.showTotalsRow,
            headerBackground: themeRef("primary"),
            headerTextColor: "#ffffff",
            borderColor: themeRef("border"),
            zebraBackground: themeRef("tint"),
            borders: "horizontal",
            style: styleBase({ fontSizePt: 9, paddingMm: 0 }),
          },
        ],
      };
    case "totals":
      return {
        heightMm: 40,
        elements: [
          {
            id: newCanvasElementId("tot"),
            type: "totals",
            xMm: widthMm * 0.45,
            yMm,
            wMm: widthMm * 0.55,
            hMm: 36,
            zIndex: 1,
            rows: block.rows.map((r) => ({ ...r })),
            background: themeRef("tint"),
            grandTotalBackground: themeRef("primary"),
            grandTotalTextColor: "#ffffff",
            style: styleBase({ fontSizePt: 10 }),
          },
        ],
      };
    case "text":
      return {
        heightMm: 16,
        elements: [
          {
            id: newCanvasElementId("txt"),
            type: "text",
            xMm: 0,
            yMm,
            wMm: widthMm,
            hMm: 14,
            zIndex: 1,
            content: block.html.replace(/<[^>]+>/g, ""),
            style: styleBase(),
          },
        ],
      };
    case "signatures":
      return {
        heightMm: 32,
        elements: [
          {
            id: newCanvasElementId("sig"),
            type: "signatures",
            xMm: 0,
            yMm,
            wMm: widthMm,
            hMm: 28,
            zIndex: 1,
            labels: [...block.labels],
            dateLabel: block.dateLabel,
            style: styleBase({ fontSizePt: 9 }),
          },
        ],
      };
    case "spacer":
      return { elements: [], heightMm: block.heightMm ?? 8 };
    case "divider":
      return {
        heightMm: 6,
        elements: [
          {
            id: newCanvasElementId("ln"),
            type: "line",
            xMm: 0,
            yMm: yMm + 2,
            wMm: widthMm,
            hMm: 2,
            zIndex: 1,
            orientation: "horizontal",
            thicknessPt: 1,
            color: themeRef("border"),
            style: styleBase({ paddingMm: 0 }),
          },
        ],
      };
    case "warranty":
    case "styleHeader":
    case "styleFooter":
      return {
        heightMm: 12,
        elements: [
          {
            id: newCanvasElementId("txt"),
            type: "text",
            xMm: 0,
            yMm,
            wMm: widthMm,
            hMm: 10,
            zIndex: 1,
            content: block.kind === "warranty" ? "#ГАРАНТИЯ" : block.kind === "styleHeader" ? "#КОМПАНИЯ-НАЗВАНИЕ" : "",
            style: styleBase({ fontSizePt: 9, color: themeRef("muted") }),
          },
        ],
      };
  }
}

/** Lay out existing blocks top-to-bottom on a canvas page. */
export function convertBlocksLayoutToCanvas(layout: DocumentLayout): CanvasDocumentLayout {
  const v2 = migrateLayoutToV2(layout);
  const widthMm = 190;
  const leaves = flattenLayoutBlocks(v2.blocks);
  const elements: CanvasElement[] = [];
  let y = 0;
  for (const leaf of leaves) {
    const { elements: next, heightMm } = leafToElements(leaf, y, widthMm);
    elements.push(...next);
    y += heightMm + 3;
  }
  return {
    version: 3,
    mode: "canvas",
    useStyle: v2.useStyle ?? true,
    page: {
      size: v2.page.size,
      orientation: v2.page.orientation,
      marginsMm: v2.page.marginsMm,
    },
    gridMm: 2,
    elements,
  };
}
