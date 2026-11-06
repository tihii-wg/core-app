/** Shared document style (colors, fonts, header/footer) used by invoice, act, and work order. */

import {
  INVOICE_PRINT_INK,
  INVOICE_PRINT_MUTED,
  INVOICE_PRINT_PRIMARY,
  INVOICE_PRINT_PRIMARY_DARK,
  INVOICE_PRINT_TINT,
} from "../invoices/invoicePrintTheme";
import {
  isColorRef,
  isSafeHexColor,
  isThemeColorRef,
  resolveColorRef,
  themeRef,
  type ColorRef,
  type StyleColorPalette,
  type ThemeColorKey,
} from "./colorRef";
import {
  isDocumentLayout,
  newBlockId,
  parseDocumentLayout,
  type DocumentLayoutPage,
  type LayoutBlock,
  type PageOrientation,
  type PageSize,
} from "./layout";

export type { ColorRef, ThemeColorKey, StyleColorPalette };
export { isColorRef, isThemeColorRef, resolveColorRef, themeRef, isSafeHexColor };

export type DocumentStyleColors = StyleColorPalette;

export type DocumentStyleFontFamily = "system" | "inter" | "serif";

export type DocumentStyleFont = {
  family: DocumentStyleFontFamily;
  baseSizePt: number;
};

export type DocumentStyleTitle = {
  align: "left" | "center" | "right";
  sizePt: number;
  color: ColorRef;
  uppercase: boolean;
};

export type DocumentStyleTable = {
  headerBackground: ColorRef;
  headerColor: ColorRef;
  borders: "all" | "horizontal" | "none";
  zebra: boolean;
};

export type DocumentStylePage = {
  size: PageSize;
  orientation: PageOrientation;
  marginsMm: number;
};

export type DocumentStyle = {
  version: 1;
  colors: DocumentStyleColors;
  font: DocumentStyleFont;
  page: DocumentStylePage;
  title: DocumentStyleTitle;
  table: DocumentStyleTable;
  sharedHeader: LayoutBlock[];
  sharedFooter: LayoutBlock[];
};

const FONT_FAMILIES = new Set<DocumentStyleFontFamily>(["system", "inter", "serif"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseHexColor(value: unknown): string | null {
  if (typeof value !== "string" || !isSafeHexColor(value)) return null;
  return value.trim();
}

function parseColorRefValue(value: unknown): ColorRef | null {
  if (typeof value !== "string" || !isColorRef(value)) return null;
  return value.trim();
}

function parseColors(value: unknown): DocumentStyleColors | null {
  if (!isRecord(value)) return null;
  const primary = parseHexColor(value.primary);
  const primaryDark = parseHexColor(value.primaryDark);
  const tint = parseHexColor(value.tint);
  const muted = parseHexColor(value.muted);
  const text = parseHexColor(value.text);
  const border = parseHexColor(value.border);
  if (!primary || !primaryDark || !tint || !muted || !text || !border) return null;
  return { primary, primaryDark, tint, muted, text, border };
}

function parseFont(value: unknown): DocumentStyleFont | null {
  if (!isRecord(value)) return null;
  if (typeof value.family !== "string" || !FONT_FAMILIES.has(value.family as DocumentStyleFontFamily)) return null;
  if (typeof value.baseSizePt !== "number" || !Number.isFinite(value.baseSizePt) || value.baseSizePt < 6 || value.baseSizePt > 24) {
    return null;
  }
  return { family: value.family as DocumentStyleFontFamily, baseSizePt: value.baseSizePt };
}

function parsePage(value: unknown): DocumentStylePage | null {
  if (!isRecord(value)) return null;
  if (value.size !== "A4" && value.size !== "A5") return null;
  if (value.orientation !== "portrait" && value.orientation !== "landscape") return null;
  if (typeof value.marginsMm !== "number" || !Number.isFinite(value.marginsMm)) return null;
  return { size: value.size, orientation: value.orientation, marginsMm: value.marginsMm };
}

function parseTitle(value: unknown): DocumentStyleTitle | null {
  if (!isRecord(value)) return null;
  if (value.align !== "left" && value.align !== "center" && value.align !== "right") return null;
  if (typeof value.sizePt !== "number" || !Number.isFinite(value.sizePt) || value.sizePt < 8 || value.sizePt > 48) return null;
  const color = parseColorRefValue(value.color);
  if (!color) return null;
  if (typeof value.uppercase !== "boolean") return null;
  return { align: value.align, sizePt: value.sizePt, color, uppercase: value.uppercase };
}

function parseTable(value: unknown): DocumentStyleTable | null {
  if (!isRecord(value)) return null;
  const headerBackground = parseColorRefValue(value.headerBackground);
  const headerColor = parseColorRefValue(value.headerColor);
  if (!headerBackground || !headerColor) return null;
  if (value.borders !== "all" && value.borders !== "horizontal" && value.borders !== "none") return null;
  if (typeof value.zebra !== "boolean") return null;
  return { headerBackground, headerColor, borders: value.borders, zebra: value.zebra };
}

function blockTreeHasStyleSlot(blocks: LayoutBlock[]): boolean {
  for (const block of blocks) {
    if (block.kind === "styleHeader" || block.kind === "styleFooter") return true;
    if (block.kind === "columns") {
      for (const column of block.columns) {
        if (blockTreeHasStyleSlot(column.blocks)) return true;
      }
    }
  }
  return false;
}

function parseSharedBlocks(value: unknown): LayoutBlock[] | null {
  if (!Array.isArray(value)) return null;
  const shell = {
    version: 2 as const,
    page: { size: "A4" as const, orientation: "portrait" as const, marginsMm: 12, fontSizePt: 10 },
    blocks: value,
  };
  if (!isDocumentLayout(shell)) return null;
  const parsed = parseDocumentLayout(shell);
  if (!parsed) return null;
  if (blockTreeHasStyleSlot(parsed.blocks)) return null;
  return parsed.blocks;
}

/** Type guard for persisted DocumentStyle JSON. */
export function isDocumentStyle(value: unknown): value is DocumentStyle {
  return parseDocumentStyle(value) != null;
}

export function parseDocumentStyle(value: unknown): DocumentStyle | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const colors = parseColors(value.colors);
  const font = parseFont(value.font);
  const page = parsePage(value.page);
  const title = parseTitle(value.title);
  const table = parseTable(value.table);
  if (!colors || !font || !page || !title || !table) return null;
  const sharedHeader = parseSharedBlocks(value.sharedHeader);
  const sharedFooter = parseSharedBlocks(value.sharedFooter);
  if (!sharedHeader || !sharedFooter) return null;
  return { version: 1, colors, font, page, title, table, sharedHeader, sharedFooter };
}

export function fontFamilyCss(family: DocumentStyleFontFamily): string {
  if (family === "inter") return '"Inter", "Segoe UI", Helvetica, Arial, sans-serif';
  if (family === "serif") return 'Georgia, "Times New Roman", Times, serif';
  return 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
}

export function stylePageToLayoutPage(page: DocumentStylePage, font: DocumentStyleFont): DocumentLayoutPage {
  return {
    size: page.size,
    orientation: page.orientation,
    marginsMm: page.marginsMm,
    fontSizePt: font.baseSizePt,
  };
}

/** Built-in default derived from the current invoice print look. */
export function defaultDocumentStyle(): DocumentStyle {
  const colors: DocumentStyleColors = {
    primary: INVOICE_PRINT_PRIMARY,
    primaryDark: INVOICE_PRINT_PRIMARY_DARK,
    tint: INVOICE_PRINT_TINT,
    muted: INVOICE_PRINT_MUTED,
    text: INVOICE_PRINT_INK,
    border: "#e5e7eb",
  };

  const sharedHeader: LayoutBlock[] = [
    {
      id: "style_header",
      kind: "columns",
      enabled: true,
      gapMm: 4,
      style: {
        background: themeRef("primary"),
        color: "#ffffff",
        padding: "md",
      },
      columns: [
        {
          id: "style_header_left",
          widthPercent: 58,
          blocks: [
            {
              id: "style_company",
              kind: "companyHeader",
              enabled: true,
              align: "left",
              style: { color: "#ffffff", padding: "none" },
              fields: [
                { token: "#КОМПАНИЯ-ЛОГОТИП", label: "Logo", enabled: true, hideIfEmpty: true },
                { label: "", template: "#КОМПАНИЯ-НАЗВАНИЕ", enabled: true, hideIfEmpty: true },
                { label: "", template: "#КОМПАНИЯ-АДРЕС", enabled: true, hideIfEmpty: true },
                { label: "", template: "#КОМПАНИЯ-EMAIL", enabled: true, hideIfEmpty: true },
              ],
            },
          ],
        },
        {
          id: "style_header_right",
          widthPercent: 42,
          blocks: [
            {
              id: "style_title",
              kind: "documentTitle",
              enabled: true,
              style: { color: "#ffffff", align: "right", fontScale: 0.85 },
              text: "#ДОКУМЕНТ-НАЗВАНИЕ",
            },
            {
              id: "style_number",
              kind: "fields",
              enabled: true,
              style: { color: "#ffffff", align: "right", padding: "none" },
              fields: [
                { label: "", template: "#ДОКУМЕНТ-НОМЕР", enabled: true, hideIfEmpty: true },
                { label: "", template: "#ДОКУМЕНТ-ДАТА", enabled: true, hideIfEmpty: true },
              ],
            },
          ],
        },
      ],
    },
  ];

  const sharedFooter: LayoutBlock[] = [
    {
      id: "style_footer",
      kind: "text",
      enabled: true,
      style: { color: themeRef("muted"), fontScale: 0.85 },
      html: "<p>#КОМПАНИЯ-НАЗВАНИЕ · #КОМПАНИЯ-EMAIL · IBAN #КОМПАНИЯ-IBAN</p><p>This is not a fiscal document.</p>",
    },
  ];

  return {
    version: 1,
    colors,
    font: { family: "system", baseSizePt: 10 },
    page: { size: "A4", orientation: "portrait", marginsMm: 10 },
    title: {
      align: "right",
      sizePt: 14,
      color: "#ffffff",
      uppercase: true,
    },
    table: {
      headerBackground: themeRef("tint"),
      headerColor: themeRef("primaryDark"),
      borders: "all",
      zebra: false,
    },
    sharedHeader,
    sharedFooter,
  };
}

/** Hex values that match the built-in defaults (used when converting hard-coded colors → theme refs). */
export function defaultStyleHexByThemeKey(): Record<ThemeColorKey, string> {
  const style = defaultDocumentStyle();
  return { ...style.colors };
}

export function newStyleBlockId(prefix = "sty") {
  return newBlockId(prefix);
}
