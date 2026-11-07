import i18n from "../i18n";
import { applyCommonStyleToLayout } from "../features/documents/applyCommonStyle";
import { createLayoutFromTemplate } from "../features/documents/createFromTemplate";
import { defaultTemplateName } from "../features/documents/defaultLayouts";
import {
  defaultDocumentStyle,
  fontFamilyCss,
  isDocumentStyle,
  parseDocumentStyle,
  stylePageToLayoutPage,
  type DocumentStyle,
} from "../features/documents/documentStyle";
import { defaultCanvasLayoutForType } from "../features/documents/canvas/defaultCanvasLayouts";
import { isCanvasDocumentLayout, parseCanvasDocumentLayout } from "../features/documents/canvas/guards";
import {
  canvasPageCss,
  renderCanvasLayoutToHtml,
  renderCanvasLayoutToHtmlSync,
} from "../features/documents/canvas/renderCanvasLayout";
import type { CanvasDocumentLayout } from "../features/documents/canvas/types";
import {
  isDocumentLayout,
  layoutPageCss,
  parseDocumentLayout,
  renderLayoutToHtml,
  toLayoutRenderStyle,
  type DocumentLayout,
  type DocumentTemplateType,
} from "../features/documents/layout";
import { applyTemplateVariables, buildPrintDocument } from "../features/documents/printTemplate";
import { translatedDocumentStyleName } from "../features/documents/printTemplateName";
import { emptyPrintContext, type PrintContext } from "../features/documents/templateVariables";
import { buildInvoicePrintContext, buildOrderPrintContext } from "./printContext";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

export type StoredDocumentLayout = DocumentLayout | CanvasDocumentLayout;

/** Print templates live in `document_templates` (Appendix A, section 9). */
export type DocumentTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  documentType: string;
  widthMm: number | null;
  heightMm: number | null;
  showCents: boolean;
  isAvailableToAll: boolean;
  isActive: boolean;
  isDefault: boolean;
  /** Visual builder layout (blocks v1/v2 or canvas v3); null = legacy body_html-only (or style rows). */
  layout: StoredDocumentLayout | null;
  /** When documentType === 'style', parsed DocumentStyle from the layout column. */
  style: DocumentStyle | null;
  /** Raw template HTML (`body_html`); empty string when absent. Sanitise before rendering. */
  bodyHtml: string;
};

export const DOCUMENT_STYLE_TYPE = "style";

const templateColumns =
  "id, workspace_id, name, document_type, body_html, layout, is_default, width_mm, height_mm, show_cents, is_available_to_all, is_active, deleted_at";

const templateColumnsNoLayout =
  "id, workspace_id, name, document_type, body_html, width_mm, height_mm, show_cents, is_available_to_all, is_active, deleted_at";

function toNullableNumber(value: unknown) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLayoutField(value: unknown): StoredDocumentLayout | null {
  if (value == null) return null;
  if (isCanvasDocumentLayout(value)) return parseCanvasDocumentLayout(value);
  return parseDocumentLayout(value);
}

export function isStoredDocumentLayout(value: unknown): value is StoredDocumentLayout {
  return isCanvasDocumentLayout(value) || isDocumentLayout(value);
}

export function toDocumentTemplate(row: Record<string, unknown>): DocumentTemplate {
  const documentType = typeof row.document_type === "string" ? row.document_type : "";
  const rawLayout = "layout" in row ? row.layout : null;
  const isStyleRow = documentType === DOCUMENT_STYLE_TYPE;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: typeof row.name === "string" ? row.name : "",
    documentType,
    widthMm: toNullableNumber(row.width_mm),
    heightMm: toNullableNumber(row.height_mm),
    showCents: row.show_cents !== false,
    isAvailableToAll: row.is_available_to_all !== false,
    isActive: row.is_active !== false,
    isDefault: row.is_default === true,
    layout: isStyleRow ? null : parseLayoutField(rawLayout),
    style: isStyleRow ? parseDocumentStyle(rawLayout) : null,
    bodyHtml: typeof row.body_html === "string" ? row.body_html : "",
  };
}

export function isBuilderDocumentType(value: string): value is DocumentTemplateType {
  return value === "work_order" || value === "act" || value === "invoice";
}

export function isDocumentStyleType(value: string): boolean {
  return value === DOCUMENT_STYLE_TYPE;
}

/** Built-in style always available — printing never fails because the style row is missing. */
export function resolveDocumentStyle(style: DocumentStyle | null | undefined): DocumentStyle {
  if (style && isDocumentStyle(style)) return style;
  return defaultDocumentStyle();
}

export function documentStyleToRenderStyle(style: DocumentStyle) {
  const resolved = resolveDocumentStyle(style);
  return toLayoutRenderStyle({
    colors: resolved.colors,
    title: resolved.title,
    table: resolved.table,
    sharedHeader: resolved.sharedHeader,
    sharedFooter: resolved.sharedFooter,
    fontFamilyCss: fontFamilyCss(resolved.font.family),
  });
}

/** Effective page CSS: style page/font when layout.useStyle, else layout.page. */
export function resolvePrintPageCss(layout: StoredDocumentLayout, style: DocumentStyle) {
  if (isCanvasDocumentLayout(layout)) {
    return canvasPageCss(layout, layout.useStyle === true ? fontFamilyCss(style.font.family) : undefined);
  }
  if (layout.useStyle === true) {
    const page = stylePageToLayoutPage(style.page, style.font);
    return layoutPageCss(page, fontFamilyCss(style.font.family));
  }
  return layoutPageCss(layout.page);
}

/** Returns [] when `document_templates` is not applied yet. Retries without layout/body_html if absent. */
export async function getDocumentTemplates(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const run = (columns: string) =>
    supabase
      .from("document_templates")
      .select(columns)
      .eq("workspace_id", resolved)
      .is("deleted_at", null)
      .order("document_type", { ascending: true })
      .order("name", { ascending: true });

  let { data, error } = await run(templateColumns);
  if (error && /layout|is_default/i.test(error.message ?? "")) {
    ({ data, error } = await run(templateColumnsNoLayout));
  }
  if (error && /body_html/i.test(error.message ?? "")) {
    ({ data, error } = await run(templateColumnsNoLayout.replace("body_html, ", "")));
  }

  if (error) {
    if (isMissingTableError(error, "document_templates")) return [] as DocumentTemplate[];
    throw new Error(error.message);
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toDocumentTemplate);
}

export type PrintOrderResult = "printed" | "unavailable";

/** Prints through a hidden same-origin iframe (no popup blocker issues). */
export function printHtmlDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return cleanup();
    win.focus();
    win.print();
    cleanup();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

/** Renders a template (layout preferred, else legacy body_html) into a full print document. */
export function renderTemplateDocument(
  template: DocumentTemplate,
  ctx: PrintContext,
  documentStyle?: DocumentStyle | null,
) {
  const layout = template.layout && isStoredDocumentLayout(template.layout) ? template.layout : null;
  if (layout) {
    const style = resolveDocumentStyle(documentStyle);
    if (isCanvasDocumentLayout(layout)) {
      const body = renderCanvasLayoutToHtmlSync(layout, ctx, {
        showCents: template.showCents,
        colors: layout.useStyle === true ? style.colors : null,
      });
      return buildPrintDocument(body, template.name, resolvePrintPageCss(layout, style));
    }
    const renderStyle = layout.useStyle === true ? documentStyleToRenderStyle(style) : null;
    const body = renderLayoutToHtml(layout, ctx, { showCents: template.showCents, style: renderStyle });
    return buildPrintDocument(body, template.name, resolvePrintPageCss(layout, style));
  }
  if (!template.bodyHtml.trim()) return null;
  const html = applyTemplateVariables(template.bodyHtml, ctx, {
    currency: ctx.currency,
    locale: ctx.locale,
    showCents: template.showCents,
  });
  return buildPrintDocument(html, template.name);
}

/** Async render (canvas QR codes as real images). Falls back to sync renderTemplateDocument. */
export async function renderTemplateDocumentAsync(
  template: DocumentTemplate,
  ctx: PrintContext,
  documentStyle?: DocumentStyle | null,
) {
  const layout = template.layout && isCanvasDocumentLayout(template.layout) ? template.layout : null;
  if (layout) {
    const style = resolveDocumentStyle(documentStyle);
    const body = await renderCanvasLayoutToHtml(layout, ctx, {
      showCents: template.showCents,
      colors: layout.useStyle === true ? style.colors : null,
    });
    return buildPrintDocument(body, template.name, resolvePrintPageCss(layout, style));
  }
  return renderTemplateDocument(template, ctx, documentStyle);
}

/**
 * Loads the workspace default DocumentStyle row, or the built-in default when missing/invalid.
 * Never throws for missing style — printing must keep working.
 */
export async function getWorkspaceDocumentStyle(workspaceId: string | undefined): Promise<DocumentStyle> {
  try {
    const resolved = requireWorkspaceId(workspaceId);
    const templates = await getDocumentTemplates(resolved);
    const styleRow = templates.find((template) => template.documentType === DOCUMENT_STYLE_TYPE && template.isActive);
    if (styleRow?.style) return resolveDocumentStyle(styleRow.style);
  } catch {
    // fall through
  }
  return defaultDocumentStyle();
}

/**
 * Prints an order using a template's layout or `body_html` and the full template-variable registry.
 * Resolves "unavailable" when the template table/row/body is missing so callers can show a toast.
 */
export async function printOrderDocument(
  orderId: string,
  templateId: string,
  workspaceId: string | undefined,
): Promise<PrintOrderResult> {
  const resolved = requireWorkspaceId(workspaceId);
  let { data, error } = await supabase
    .from("document_templates")
    .select(templateColumns)
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error && /layout|is_default/i.test(error.message ?? "")) {
    ({ data, error } = await supabase
      .from("document_templates")
      .select(templateColumnsNoLayout)
      .eq("workspace_id", resolved)
      .eq("id", templateId)
      .is("deleted_at", null)
      .maybeSingle());
  }

  if (error) {
    if (isMissingTableError(error, "document_templates") || /body_html/i.test(error.message ?? "")) return "unavailable";
    throw new Error(error.message);
  }
  if (!data) return "unavailable";
  const template = toDocumentTemplate(data as Record<string, unknown>);
  const kind: DocumentTemplateType = template.documentType === "act" ? "act" : "work_order";

  const [ctx, documentStyle] = await Promise.all([
    buildOrderPrintContext(orderId, resolved, kind),
    getWorkspaceDocumentStyle(resolved),
  ]);
  if (ctx.order && !ctx.order.orderNumber.trim()) {
    ctx.order = { ...ctx.order, orderNumber: i18n.t("orders.emptyOrderLabel") };
  }

  const documentHtml = await renderTemplateDocumentAsync(template, ctx, documentStyle);
  if (!documentHtml) return "unavailable";
  printHtmlDocument(documentHtml);
  return "printed";
}

/** Prints an invoice via a document template layout/body_html. */
export async function printInvoiceDocument(
  invoiceId: string,
  templateId: string,
  workspaceId: string | undefined,
): Promise<PrintOrderResult> {
  const resolved = requireWorkspaceId(workspaceId);
  let { data, error } = await supabase
    .from("document_templates")
    .select(templateColumns)
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error && /layout|is_default/i.test(error.message ?? "")) {
    ({ data, error } = await supabase
      .from("document_templates")
      .select(templateColumnsNoLayout)
      .eq("workspace_id", resolved)
      .eq("id", templateId)
      .is("deleted_at", null)
      .maybeSingle());
  }

  if (error) {
    if (isMissingTableError(error, "document_templates") || /body_html/i.test(error.message ?? "")) return "unavailable";
    throw new Error(error.message);
  }
  if (!data) return "unavailable";
  const template = toDocumentTemplate(data as Record<string, unknown>);
  try {
    const [ctx, documentStyle] = await Promise.all([
      buildInvoicePrintContext(invoiceId, resolved),
      getWorkspaceDocumentStyle(resolved),
    ]);
    const documentHtml = await renderTemplateDocumentAsync(template, ctx, documentStyle);
    if (!documentHtml) return "unavailable";
    printHtmlDocument(documentHtml);
    return "printed";
  } catch {
    return "unavailable";
  }
}

/** Max stored template HTML (characters) — guards against pasting huge documents into a text column. */
export const MAX_TEMPLATE_BODY_LENGTH = 200_000;

function mapTemplateWriteError(error: { code?: string; message: string }) {
  if (isMissingTableError(error, "document_templates") || /body_html|layout|is_default/i.test(error.message ?? "")) {
    throw new Error(i18n.t("settings.printTemplates.errors.unavailable"));
  }
  if (error.code === "42501") throw new Error(i18n.t("settings.printTemplates.errors.noPermission"));
  throw new Error(error.message);
}

/**
 * Saves `body_html` of a print template. The raw text is stored (variables like `#КЛИЕНТ-ИМЯ` must survive);
 * it is always sanitised when displayed or printed (`buildPrintDocument`). RLS requires `settings.print_templates`.
 */
export async function updateDocumentTemplateBody(templateId: string, bodyHtml: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  if (bodyHtml.length > MAX_TEMPLATE_BODY_LENGTH) throw new Error(i18n.t("settings.printTemplates.errors.tooLong"));
  const { data, error } = await supabase
    .from("document_templates")
    .update({ body_html: bodyHtml })
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .select("id");

  if (error) mapTemplateWriteError(error);
  if (!data || data.length === 0) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
}

export type SaveDocumentTemplateLayoutInput = {
  templateId: string;
  layout: StoredDocumentLayout;
  bodyHtml: string;
  name?: string;
  workspaceId: string | undefined;
};

/** Saves layout JSON and a rendered body_html snapshot for legacy readers. */
export async function saveDocumentTemplateLayout(input: SaveDocumentTemplateLayoutInput) {
  const resolved = requireWorkspaceId(input.workspaceId);
  if (!isStoredDocumentLayout(input.layout)) throw new Error(i18n.t("settings.printTemplates.errors.invalidLayout"));
  if (input.bodyHtml.length > MAX_TEMPLATE_BODY_LENGTH) throw new Error(i18n.t("settings.printTemplates.errors.tooLong"));
  const patch: Record<string, unknown> = {
    layout: input.layout,
    body_html: input.bodyHtml,
  };
  if (typeof input.name === "string") patch.name = input.name.trim() || input.name;
  const { data, error } = await supabase
    .from("document_templates")
    .update(patch)
    .eq("workspace_id", resolved)
    .eq("id", input.templateId)
    .is("deleted_at", null)
    .select("id");
  if (error) mapTemplateWriteError(error);
  if (!data || data.length === 0) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
}

export async function createDocumentTemplate(
  documentType: DocumentTemplateType,
  workspaceId: string | undefined,
  name?: string,
  options: { isDefault?: boolean; layout?: CanvasDocumentLayout | DocumentLayout | null } = {},
) {
  const resolved = requireWorkspaceId(workspaceId);
  const layout =
    options.layout && isStoredDocumentLayout(options.layout)
      ? options.layout
      : defaultCanvasLayoutForType(documentType, i18n.t.bind(i18n));
  const emptyCtxBody = isCanvasDocumentLayout(layout)
    ? renderCanvasLayoutToHtmlSync(layout, emptyPrintContext({ locale: "ru" }), {
        colors: defaultDocumentStyle().colors,
      })
    : renderLayoutToHtml(layout, emptyPrintContext({ locale: "ru" }), {
        style: documentStyleToRenderStyle(defaultDocumentStyle()),
      });
  const { data, error } = await supabase
    .from("document_templates")
    .insert({
      workspace_id: resolved,
      name: (name?.trim() || defaultTemplateName(documentType)).slice(0, 200),
      document_type: documentType,
      layout,
      body_html: emptyCtxBody,
      is_default: options.isDefault === true,
      is_active: true,
      is_available_to_all: true,
      show_cents: true,
    })
    .select(templateColumns)
    .single();
  if (error) mapTemplateWriteError(error);
  return toDocumentTemplate(data as Record<string, unknown>);
}

/**
 * Ensures the workspace has a default invoice template (Standard invoice).
 * One insert when none exist; ignores unique-index conflicts if a default already appeared.
 */
export async function ensureDefaultInvoiceTemplate(workspaceId: string | undefined): Promise<DocumentTemplate | null> {
  const resolved = requireWorkspaceId(workspaceId);
  const templates = await getDocumentTemplates(resolved);
  const invoices = templates.filter((template) => template.documentType === "invoice" && template.isActive);
  if (invoices.length > 0) {
    return invoices.find((template) => template.isDefault) ?? invoices[0] ?? null;
  }
  try {
    return await createDocumentTemplate("invoice", resolved, i18n.t("settings.printTemplates.standardInvoice"), {
      isDefault: true,
    });
  } catch (error) {
    // Unique index on default: another client created it — reload.
    const again = await getDocumentTemplates(resolved);
    const found = again.find((template) => template.documentType === "invoice" && template.isDefault);
    if (found) return found;
    if (error instanceof Error) throw error;
    return null;
  }
}

/**
 * Ensures a default DocumentStyle row (document_type = 'style', is_default = true).
 * Stores DocumentStyle JSON in the layout column. Ignores unique-index races.
 */
export async function ensureDefaultDocumentStyle(workspaceId: string | undefined): Promise<DocumentTemplate | null> {
  const resolved = requireWorkspaceId(workspaceId);
  const templates = await getDocumentTemplates(resolved);
  const existing = templates.find((template) => template.documentType === DOCUMENT_STYLE_TYPE && template.isActive);
  if (existing) return existing;
  const style = defaultDocumentStyle();
  try {
    const { data, error } = await supabase
      .from("document_templates")
      .insert({
        workspace_id: resolved,
        name: translatedDocumentStyleName(),
        document_type: DOCUMENT_STYLE_TYPE,
        layout: style,
        body_html: "",
        is_default: true,
        is_active: true,
        is_available_to_all: true,
        show_cents: true,
      })
      .select(templateColumns)
      .single();
    if (error) mapTemplateWriteError(error);
    return toDocumentTemplate(data as Record<string, unknown>);
  } catch (error) {
    const again = await getDocumentTemplates(resolved);
    const found = again.find((template) => template.documentType === DOCUMENT_STYLE_TYPE && template.isDefault);
    if (found) return found;
    if (error instanceof Error) throw error;
    return null;
  }
}

/** Saves DocumentStyle JSON into the style template's layout column. */
export async function saveDocumentStyle(
  templateId: string,
  style: DocumentStyle,
  workspaceId: string | undefined,
  name?: string,
) {
  const resolved = requireWorkspaceId(workspaceId);
  if (!isDocumentStyle(style)) throw new Error(i18n.t("settings.printTemplates.errors.invalidLayout"));
  const patch: Record<string, unknown> = {
    layout: style,
    body_html: "",
    document_type: DOCUMENT_STYLE_TYPE,
  };
  if (typeof name === "string") patch.name = name.trim() || name;
  const { data, error } = await supabase
    .from("document_templates")
    .update(patch)
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .select("id");
  if (error) mapTemplateWriteError(error);
  if (!data || data.length === 0) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
}

/**
 * Creates the other document types from a source template's layout (mapped sources/tokens).
 * Returns created templates and any unmapped tokens from the first conversion.
 */
export async function createTemplatesFromSource(
  sourceTemplateId: string,
  workspaceId: string | undefined,
  targets: DocumentTemplateType[],
): Promise<{ created: DocumentTemplate[]; unmappedTokens: string[] }> {
  const resolved = requireWorkspaceId(workspaceId);
  const templates = await getDocumentTemplates(resolved);
  const source = templates.find((template) => template.id === sourceTemplateId);
  if (!source || !source.layout || !isBuilderDocumentType(source.documentType) || isCanvasDocumentLayout(source.layout)) {
    throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
  }
  const fromType = source.documentType;
  const created: DocumentTemplate[] = [];
  let unmappedTokens: string[] = [];
  for (const toType of targets) {
    if (toType === fromType) continue;
    const { layout, unmappedTokens: unmapped } = createLayoutFromTemplate(source.layout, fromType, toType);
    if (unmappedTokens.length === 0) unmappedTokens = unmapped;
    const bodyHtml = renderLayoutToHtml(layout, emptyPrintContext({ locale: "ru", documentKind: toType }), {
      style: documentStyleToRenderStyle(defaultDocumentStyle()),
    });
    const { data, error } = await supabase
      .from("document_templates")
      .insert({
        workspace_id: resolved,
        name: `${source.name} → ${defaultTemplateName(toType)}`.slice(0, 200),
        document_type: toType,
        layout,
        body_html: bodyHtml,
        is_default: false,
        is_active: true,
        is_available_to_all: true,
        show_cents: source.showCents,
      })
      .select(templateColumns)
      .single();
    if (error) mapTemplateWriteError(error);
    created.push(toDocumentTemplate(data as Record<string, unknown>));
  }
  return { created, unmappedTokens };
}

/** Sets useStyle=true and replaces default hex colors with theme refs on all builder templates. */
export async function applyCommonStyleToAllTemplates(workspaceId: string | undefined): Promise<number> {
  const resolved = requireWorkspaceId(workspaceId);
  const templates = await getDocumentTemplates(resolved);
  let updated = 0;
  for (const template of templates) {
    if (!isBuilderDocumentType(template.documentType) || !template.layout || isCanvasDocumentLayout(template.layout)) continue;
    const next = applyCommonStyleToLayout(template.layout);
    const bodyHtml = renderLayoutToHtml(next, emptyPrintContext({ locale: "ru", documentKind: template.documentType }), {
      style: documentStyleToRenderStyle(await getWorkspaceDocumentStyle(resolved)),
    });
    const { error } = await supabase
      .from("document_templates")
      .update({ layout: next, body_html: bodyHtml })
      .eq("workspace_id", resolved)
      .eq("id", template.id)
      .is("deleted_at", null);
    if (error) mapTemplateWriteError(error);
    updated += 1;
  }
  return updated;
}

export async function duplicateDocumentTemplate(templateId: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const templates = await getDocumentTemplates(resolved);
  const source = templates.find((template) => template.id === templateId);
  if (!source) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
  const { data, error } = await supabase
    .from("document_templates")
    .insert({
      workspace_id: resolved,
      name: `${source.name} (copy)`.slice(0, 200),
      document_type: source.documentType,
      layout: source.layout,
      body_html: source.bodyHtml,
      is_default: false,
      is_active: source.isActive,
      is_available_to_all: source.isAvailableToAll,
      show_cents: source.showCents,
      width_mm: source.widthMm,
      height_mm: source.heightMm,
    })
    .select(templateColumns)
    .single();
  if (error) mapTemplateWriteError(error);
  return toDocumentTemplate(data as Record<string, unknown>);
}

export async function renameDocumentTemplate(templateId: string, name: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const trimmed = name.trim();
  if (!trimmed) throw new Error(i18n.t("settings.printTemplates.errors.nameRequired"));
  const { data, error } = await supabase
    .from("document_templates")
    .update({ name: trimmed.slice(0, 200) })
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .select("id");
  if (error) mapTemplateWriteError(error);
  if (!data || data.length === 0) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
}

/** Soft-delete via deleted_at. */
export async function softDeleteDocumentTemplate(templateId: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("document_templates")
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .select("id");
  if (error) mapTemplateWriteError(error);
  if (!data || data.length === 0) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
}

/**
 * Sets a template as the default for its document_type.
 * Unsets the previous default first so the unique partial index is respected.
 */
export async function setDefaultDocumentTemplate(templateId: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const templates = await getDocumentTemplates(resolved);
  const target = templates.find((template) => template.id === templateId);
  if (!target) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));

  const previousDefaults = templates.filter(
    (template) => template.documentType === target.documentType && template.isDefault && template.id !== templateId,
  );
  for (const previous of previousDefaults) {
    const { error } = await supabase
      .from("document_templates")
      .update({ is_default: false })
      .eq("workspace_id", resolved)
      .eq("id", previous.id)
      .is("deleted_at", null);
    if (error) mapTemplateWriteError(error);
  }

  const { data, error } = await supabase
    .from("document_templates")
    .update({ is_default: true })
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .select("id");
  if (error) mapTemplateWriteError(error);
  if (!data || data.length === 0) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
}

/** Snapshot body_html from a layout + context (or empty context). */
export function snapshotBodyHtmlFromLayout(
  layout: StoredDocumentLayout,
  ctx: PrintContext,
  showCents = true,
  documentStyle?: DocumentStyle | null,
) {
  if (isCanvasDocumentLayout(layout)) {
    const resolved = resolveDocumentStyle(documentStyle);
    return renderCanvasLayoutToHtmlSync(layout, ctx, {
      showCents,
      colors: layout.useStyle === true ? resolved.colors : null,
    });
  }
  const style = layout.useStyle === true ? documentStyleToRenderStyle(resolveDocumentStyle(documentStyle)) : null;
  return renderLayoutToHtml(layout, ctx, { showCents, style });
}
