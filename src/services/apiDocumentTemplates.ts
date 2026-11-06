import i18n from "../i18n";
import { defaultLayoutForType, defaultTemplateName } from "../features/documents/defaultLayouts";
import {
  isDocumentLayout,
  layoutPageCss,
  parseDocumentLayout,
  renderLayoutToHtml,
  type DocumentLayout,
  type DocumentTemplateType,
} from "../features/documents/layout";
import { applyTemplateVariables, buildPrintDocument } from "../features/documents/printTemplate";
import { emptyPrintContext, type PrintContext } from "../features/documents/templateVariables";
import { buildInvoicePrintContext, buildOrderPrintContext } from "./printContext";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

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
  /** Visual builder layout; null = legacy body_html-only template. */
  layout: DocumentLayout | null;
  /** Raw template HTML (`body_html`); empty string when absent. Sanitise before rendering. */
  bodyHtml: string;
};

const templateColumns =
  "id, workspace_id, name, document_type, body_html, layout, is_default, width_mm, height_mm, show_cents, is_available_to_all, is_active, deleted_at";

const templateColumnsNoLayout =
  "id, workspace_id, name, document_type, body_html, width_mm, height_mm, show_cents, is_available_to_all, is_active, deleted_at";

function toNullableNumber(value: unknown) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLayoutField(value: unknown): DocumentLayout | null {
  if (value == null) return null;
  return parseDocumentLayout(value);
}

export function toDocumentTemplate(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: typeof row.name === "string" ? row.name : "",
    documentType: typeof row.document_type === "string" ? row.document_type : "",
    widthMm: toNullableNumber(row.width_mm),
    heightMm: toNullableNumber(row.height_mm),
    showCents: row.show_cents !== false,
    isAvailableToAll: row.is_available_to_all !== false,
    isActive: row.is_active !== false,
    isDefault: row.is_default === true,
    layout: "layout" in row ? parseLayoutField(row.layout) : null,
    bodyHtml: typeof row.body_html === "string" ? row.body_html : "",
  };
}

export function isBuilderDocumentType(value: string): value is DocumentTemplateType {
  return value === "work_order" || value === "act" || value === "invoice";
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
function printHtmlDocument(html: string) {
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
export function renderTemplateDocument(template: DocumentTemplate, ctx: PrintContext) {
  const layout = template.layout && isDocumentLayout(template.layout) ? template.layout : null;
  if (layout) {
    const body = renderLayoutToHtml(layout, ctx, { showCents: template.showCents });
    return buildPrintDocument(body, template.name, layoutPageCss(layout.page));
  }
  if (!template.bodyHtml.trim()) return null;
  const html = applyTemplateVariables(template.bodyHtml, ctx, {
    currency: ctx.currency,
    locale: ctx.locale,
    showCents: template.showCents,
  });
  return buildPrintDocument(html, template.name);
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

  const ctx = await buildOrderPrintContext(orderId, resolved);
  if (ctx.order && !ctx.order.orderNumber.trim()) {
    ctx.order = { ...ctx.order, orderNumber: i18n.t("orders.emptyOrderLabel") };
  }

  const documentHtml = renderTemplateDocument(template, ctx);
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
  const ctx = await buildInvoicePrintContext(invoiceId, resolved);
  const documentHtml = renderTemplateDocument(template, ctx);
  if (!documentHtml) return "unavailable";
  printHtmlDocument(documentHtml);
  return "printed";
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
  layout: DocumentLayout;
  bodyHtml: string;
  name?: string;
  workspaceId: string | undefined;
};

/** Saves layout JSON and a rendered body_html snapshot for legacy readers. */
export async function saveDocumentTemplateLayout(input: SaveDocumentTemplateLayoutInput) {
  const resolved = requireWorkspaceId(input.workspaceId);
  if (!isDocumentLayout(input.layout)) throw new Error(i18n.t("settings.printTemplates.errors.invalidLayout"));
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
) {
  const resolved = requireWorkspaceId(workspaceId);
  const layout = defaultLayoutForType(documentType);
  const emptyCtxBody = renderLayoutToHtml(layout, emptyPrintContext({ locale: "ru" }));
  const { data, error } = await supabase
    .from("document_templates")
    .insert({
      workspace_id: resolved,
      name: (name?.trim() || defaultTemplateName(documentType)).slice(0, 200),
      document_type: documentType,
      layout,
      body_html: emptyCtxBody,
      is_default: false,
      is_active: true,
      is_available_to_all: true,
      show_cents: true,
    })
    .select(templateColumns)
    .single();
  if (error) mapTemplateWriteError(error);
  return toDocumentTemplate(data as Record<string, unknown>);
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
export function snapshotBodyHtmlFromLayout(layout: DocumentLayout, ctx: PrintContext, showCents = true) {
  return renderLayoutToHtml(layout, ctx, { showCents });
}
