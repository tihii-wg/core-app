import i18n from "../i18n";
import { applyPrintVariables, buildPrintDocument } from "../features/documents/printTemplate";
import { getOrder } from "./apiOrders";
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
  /** Raw template HTML (`body_html`); empty string when absent. Sanitise before rendering. */
  bodyHtml: string;
};

const templateColumns =
  "id, workspace_id, name, document_type, body_html, width_mm, height_mm, show_cents, is_available_to_all, is_active, deleted_at";

function toNullableNumber(value: unknown) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    bodyHtml: typeof row.body_html === "string" ? row.body_html : "",
  };
}

/** Returns [] when `document_templates` is not applied yet. Retries without `body_html` if that column is absent. */
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
  if (error && /body_html/i.test(error.message ?? "")) {
    ({ data, error } = await run(templateColumns.replace("body_html, ", "")));
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

/**
 * Prints an order using a template's `body_html` with a minimal variable set
 * (#ЗАКАЗ-НОМЕР, #КЛИЕНТ-ИМЯ, #СТАТУС, #ВАЛЮТА).
 * Resolves "unavailable" when the template table/row/body is missing so callers can show a toast.
 */
export async function printOrderDocument(
  orderId: string,
  templateId: string,
  workspaceId: string | undefined,
): Promise<PrintOrderResult> {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("document_templates")
    .select(templateColumns)
    .eq("workspace_id", resolved)
    .eq("id", templateId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error, "document_templates") || /body_html/i.test(error.message ?? "")) return "unavailable";
    throw new Error(error.message);
  }
  if (!data) return "unavailable";
  const template = toDocumentTemplate(data as Record<string, unknown>);
  if (!template.bodyHtml.trim()) return "unavailable";

  const order = await getOrder(orderId, resolved);
  const { data: workspace } = await supabase.from("workspaces").select("currency").eq("id", resolved).maybeSingle();
  const currency = typeof workspace?.currency === "string" ? workspace.currency : "";

  const html = applyPrintVariables(template.bodyHtml, {
    orderNumber: order.orderNumber || i18n.t("orders.emptyOrderLabel"),
    clientName: order.clientName ?? "",
    status: order.customStatus?.name ?? order.status,
    currency,
  });
  printHtmlDocument(buildPrintDocument(html, template.name));
  return "printed";
}

/** Max stored template HTML (characters) — guards against pasting huge documents into a text column. */
export const MAX_TEMPLATE_BODY_LENGTH = 200_000;

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

  if (error) {
    if (isMissingTableError(error, "document_templates") || /body_html/i.test(error.message ?? "")) {
      throw new Error(i18n.t("settings.printTemplates.errors.unavailable"));
    }
    if (error.code === "42501") throw new Error(i18n.t("settings.printTemplates.errors.noPermission"));
    throw new Error(error.message);
  }
  // RLS hides rows the caller may not update: an empty result means "not found or not allowed".
  if (!data || data.length === 0) throw new Error(i18n.t("settings.printTemplates.errors.notSaved"));
}
