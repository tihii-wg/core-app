/** Clone a layout into another document type, mapping table sources and type-specific tokens. */

import type { DocumentLayout, DocumentTemplateType, LayoutBlock, TableSource } from "./layout";

const TABLE_SOURCE_MAP: Record<DocumentTemplateType, Partial<Record<TableSource, TableSource>>> = {
  invoice: {
    services: "invoiceWorks",
    materials: "invoiceMaterials",
    allLines: "invoiceLines",
  },
  work_order: {
    invoiceWorks: "services",
    invoiceMaterials: "materials",
    invoiceLines: "allLines",
    prepaymentLine: "allLines",
    balanceLine: "allLines",
  },
  act: {
    invoiceWorks: "allLines",
    invoiceMaterials: "allLines",
    invoiceLines: "allLines",
    services: "allLines",
    materials: "allLines",
    prepaymentLine: "allLines",
    balanceLine: "allLines",
  },
};

/** Token remaps when converting between invoice ↔ order documents. */
const TOKEN_MAP_TO_ORDER: Record<string, string> = {
  "#СЧЁТ-НОМЕР": "#ЗАКАЗ-НОМЕР",
  "#СЧЁТ-ДАТА": "#ЗАКАЗ-ДАТА",
  "#СЧЁТ-ОПИСАНИЕ": "#ЗАКАЗ-ОПИСАНИЕ",
  "#СЧЁТ-ЗАКАЗ": "#ЗАКАЗ-НОМЕР",
  "#СЧЁТ-УСТРОЙСТВО": "#АВТО-МОДЕЛЬ",
  "#СЧЁТ-НОМЕР-АВТО": "#АВТО-НОМЕР",
  "#СЧЁТ-VIN": "#АВТО-VIN",
  "#ПОКУПАТЕЛЬ-ИМЯ": "#КЛИЕНТ-ИМЯ",
  "#ПОКУПАТЕЛЬ-ТЕЛЕФОН": "#КЛИЕНТ-ТЕЛЕФОН",
  "#ПОКУПАТЕЛЬ-EMAIL": "#КЛИЕНТ-EMAIL",
  "#ПОКУПАТЕЛЬ-АДРЕС": "#КЛИЕНТ-АДРЕС",
};

const TOKEN_MAP_TO_INVOICE: Record<string, string> = {
  "#ЗАКАЗ-НОМЕР": "#СЧЁТ-НОМЕР",
  "#ЗАКАЗ-ДАТА": "#СЧЁТ-ДАТА",
  "#ЗАКАЗ-ОПИСАНИЕ": "#СЧЁТ-ОПИСАНИЕ",
  "#АВТО-МОДЕЛЬ": "#СЧЁТ-УСТРОЙСТВО",
  "#АВТО-НОМЕР": "#СЧЁТ-НОМЕР-АВТО",
  "#АВТО-VIN": "#СЧЁТ-VIN",
  "#КЛИЕНТ-ИМЯ": "#ПОКУПАТЕЛЬ-ИМЯ",
  "#КЛИЕНТ-ТЕЛЕФОН": "#ПОКУПАТЕЛЬ-ТЕЛЕФОН",
  "#КЛИЕНТ-EMAIL": "#ПОКУПАТЕЛЬ-EMAIL",
  "#КЛИЕНТ-АДРЕС": "#ПОКУПАТЕЛЬ-АДРЕС",
};

const TOKEN_RE = /#[A-ZА-ЯЁ0-9-]+/giu;

function mapToken(token: string, from: DocumentTemplateType, to: DocumentTemplateType): string | null {
  if (from === to) return token;
  if (token === "#ДОКУМЕНТ-НАЗВАНИЕ" || token === "#ДОКУМЕНТ-НОМЕР" || token === "#ДОКУМЕНТ-ДАТА") return token;
  if (to === "invoice" && (from === "work_order" || from === "act")) {
    return TOKEN_MAP_TO_INVOICE[token] ?? null;
  }
  if ((to === "work_order" || to === "act") && from === "invoice") {
    return TOKEN_MAP_TO_ORDER[token] ?? null;
  }
  // act ↔ work_order: tokens stay the same
  if ((from === "act" || from === "work_order") && (to === "act" || to === "work_order")) return token;
  return null;
}

function rewriteText(text: string, from: DocumentTemplateType, to: DocumentTemplateType, unmapped: Set<string>): string {
  return text.replace(TOKEN_RE, (token) => {
    const upper = token; // keep original casing from source
    const mapped = mapToken(upper, from, to);
    if (mapped == null) {
      // Company / shared tokens stay as-is
      if (
        upper.startsWith("#КОМПАНИЯ") ||
        upper.startsWith("#ГАРАНТИЯ") ||
        upper.startsWith("#ИСПОЛНИТЕЛЬ") ||
        upper.startsWith("#СУММА") ||
        upper.startsWith("#ОПЛАЧ") ||
        upper.startsWith("#ОСТАТ") ||
        upper.startsWith("#НДС") ||
        upper.startsWith("#ВАЛЮТА") ||
        upper.startsWith("#ДАТА") ||
        upper.startsWith("#КЛИЕНТ") ||
        upper.startsWith("#АВТО") ||
        upper.startsWith("#ЗАКАЗ") ||
        upper.startsWith("#СТАТУС") ||
        upper.startsWith("#ДОКУМЕНТ")
      ) {
        return upper;
      }
      unmapped.add(upper);
      return upper;
    }
    return mapped;
  });
}

function mapTableSource(source: TableSource, to: DocumentTemplateType): TableSource {
  return TABLE_SOURCE_MAP[to][source] ?? source;
}

function mapBlock(block: LayoutBlock, from: DocumentTemplateType, to: DocumentTemplateType, unmapped: Set<string>): LayoutBlock {
  if (block.kind === "columns") {
    return {
      ...block,
      columns: block.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((child) => mapBlock(child, from, to, unmapped)),
      })),
    };
  }
  if (block.kind === "fields" || block.kind === "companyHeader") {
    return {
      ...block,
      title: block.title ? rewriteText(block.title, from, to, unmapped) : block.title,
      fields: block.fields.map((field) => ({
        ...field,
        label: rewriteText(field.label, from, to, unmapped),
        template: field.template != null ? rewriteText(field.template, from, to, unmapped) : field.template,
        token: field.token != null ? rewriteText(field.token, from, to, unmapped) : field.token,
      })),
    };
  }
  if (block.kind === "documentTitle") {
    return { ...block, text: rewriteText(block.text, from, to, unmapped) };
  }
  if (block.kind === "text") {
    return { ...block, html: rewriteText(block.html, from, to, unmapped) };
  }
  if (block.kind === "table") {
    return {
      ...block,
      title: block.title ? rewriteText(block.title, from, to, unmapped) : block.title,
      source: mapTableSource(block.source, to),
      columns: block.columns.map((column) => ({
        ...column,
        label: rewriteText(column.label, from, to, unmapped),
      })),
    };
  }
  if (block.kind === "totals") {
    return {
      ...block,
      title: block.title ? rewriteText(block.title, from, to, unmapped) : block.title,
      rows: block.rows.map((row) => ({
        ...row,
        label: rewriteText(row.label, from, to, unmapped),
      })),
    };
  }
  return block;
}

export type CreateFromTemplateResult = {
  layout: DocumentLayout;
  unmappedTokens: string[];
};

/** Deep-clones a layout for another document type, remapping sources/tokens. */
export function createLayoutFromTemplate(
  source: DocumentLayout,
  fromType: DocumentTemplateType,
  toType: DocumentTemplateType,
): CreateFromTemplateResult {
  const unmapped = new Set<string>();
  const blocks = source.blocks.map((block) => mapBlock(structuredClone(block), fromType, toType, unmapped));
  return {
    layout: {
      version: 2,
      page: { ...source.page },
      useStyle: source.useStyle,
      blocks,
    },
    unmappedTokens: [...unmapped].sort(),
  };
}
