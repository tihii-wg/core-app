import type { DocumentLayout, LayoutBlock } from "./layout";
import {
  findUnknownTemplateTokens,
  isCssHexToken,
  knownTemplateTokens,
} from "./templateVariables";
import type { CanvasDocumentLayout, CanvasElement } from "./canvas/types";

const TOKEN_PATTERN = /#[A-ZА-ЯЁ0-9-]+/giu;

export type UnknownTokenHit = {
  token: string;
  /** Human-readable location (block kind / canvas element type + short id). */
  location: string;
};

function pushTokensFromText(text: string, location: string, out: UnknownTokenHit[], known: Set<string>) {
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (isCssHexToken(token)) continue;
    if (!known.has(token)) out.push({ token, location });
  }
}

function scanBlock(block: LayoutBlock, out: UnknownTokenHit[], known: Set<string>) {
  const location = `${block.kind}:${block.id}`;
  if (block.title) pushTokensFromText(block.title, location, out, known);
  switch (block.kind) {
    case "companyHeader":
    case "fields":
      for (const field of block.fields) {
        if (field.token) pushTokensFromText(field.token, location, out, known);
        if (field.template) pushTokensFromText(field.template, location, out, known);
        if (field.label) pushTokensFromText(field.label, location, out, known);
      }
      break;
    case "documentTitle":
      pushTokensFromText(block.text, location, out, known);
      break;
    case "text":
      pushTokensFromText(block.html, location, out, known);
      break;
    case "table":
      for (const column of block.columns) {
        if (column.label) pushTokensFromText(column.label, location, out, known);
      }
      break;
    case "totals":
      for (const row of block.rows) {
        if (row.label) pushTokensFromText(row.label, location, out, known);
      }
      break;
    case "signatures":
      for (const label of block.labels) pushTokensFromText(label, location, out, known);
      if (block.dateLabel) pushTokensFromText(block.dateLabel, location, out, known);
      break;
    case "columns":
      for (const column of block.columns) {
        for (const child of column.blocks) scanBlock(child, out, known);
      }
      break;
    default:
      break;
  }
}

/** Unknown `#TOKENS` used in a block (v1/v2) layout, with block location. */
export function findUnknownTokensInDocumentLayout(layout: DocumentLayout): UnknownTokenHit[] {
  const known = knownTemplateTokens();
  const out: UnknownTokenHit[] = [];
  for (const block of layout.blocks) scanBlock(block, out, known);
  return dedupeHits(out);
}

function canvasElementLabel(element: CanvasElement): string {
  if (element.type === "text") {
    const preview = element.content.replace(/\s+/g, " ").trim().slice(0, 40);
    return preview ? `text “${preview}”` : `text:${element.id}`;
  }
  if (element.type === "variable") return `variable ${element.token || element.id}`;
  return `${element.type}:${element.id}`;
}

function scanCanvasElement(element: CanvasElement, out: UnknownTokenHit[], known: Set<string>) {
  const location = canvasElementLabel(element);
  switch (element.type) {
    case "text":
      pushTokensFromText(element.content, location, out, known);
      break;
    case "variable":
      pushTokensFromText(element.token, location, out, known);
      if (element.label) pushTokensFromText(element.label, location, out, known);
      break;
    case "table":
      for (const column of element.columns) {
        if (column.label) pushTokensFromText(column.label, location, out, known);
      }
      break;
    case "totals":
      for (const row of element.rows) {
        if (row.label) pushTokensFromText(row.label, location, out, known);
      }
      break;
    case "signatures":
      for (const label of element.labels) pushTokensFromText(label, location, out, known);
      if (element.dateLabel) pushTokensFromText(element.dateLabel, location, out, known);
      break;
    case "qr":
      if (element.contentToken) pushTokensFromText(element.contentToken, location, out, known);
      break;
    case "pageNumber":
      if (element.format) pushTokensFromText(element.format, location, out, known);
      break;
    default:
      break;
  }
}

/** Unknown `#TOKENS` used in a canvas (v3) layout, with element location. */
export function findUnknownTokensInCanvasLayout(layout: CanvasDocumentLayout): UnknownTokenHit[] {
  const known = knownTemplateTokens();
  const out: UnknownTokenHit[] = [];
  for (const element of layout.elements) scanCanvasElement(element, out, known);
  return dedupeHits(out);
}

function dedupeHits(hits: UnknownTokenHit[]): UnknownTokenHit[] {
  const seen = new Set<string>();
  const result: UnknownTokenHit[] = [];
  for (const hit of hits) {
    const key = `${hit.token}\0${hit.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }
  return result;
}

/** Collect every template-looking token from an arbitrary layout JSON blob (for registry coverage tests). */
export function collectTemplateTokensFromSource(source: unknown): string[] {
  const text = typeof source === "string" ? source : JSON.stringify(source);
  const found = new Set<string>();
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (isCssHexToken(token)) continue;
    found.add(token);
  }
  return [...found].sort();
}

export function unknownTokensInHtml(html: string): string[] {
  return findUnknownTemplateTokens(html);
}
