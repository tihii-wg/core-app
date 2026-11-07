import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { renderTemplateDocument } from "../../services/apiDocumentTemplates";
import type { DocumentStyle } from "./documentStyle";
import { DEMO_PRINT_SOURCE_ID, demoPrintContext } from "./demoPrintContext";
import type { PrintContext, PrintDocumentKind } from "./templateVariables";

const previewHtmlCache = new Map<string, string>();

export function isDemoPrintSource(id: string | null | undefined): boolean {
  return !id || id === DEMO_PRINT_SOURCE_ID;
}

export function templatePreviewCacheKey(template: DocumentTemplate, styleVersion = ""): string {
  const layoutKey = template.layout ? JSON.stringify(template.layout) : "legacy";
  return [
    template.id,
    template.documentType,
    template.showCents ? "1" : "0",
    String(template.bodyHtml.length),
    layoutKey,
    styleVersion,
  ].join("|");
}

export function clearTemplatePreviewHtmlCache() {
  previewHtmlCache.clear();
}

function asDocumentKind(documentType: string): PrintDocumentKind {
  if (documentType === "act" || documentType === "invoice") return documentType;
  return "work_order";
}

export function demoContextForTemplate(
  template: DocumentTemplate,
  opts: {
    locale: string;
    currency: string;
    vatRate?: number | null;
    logoUrl?: string | null;
    companyName?: string | null;
    industrySlug?: string | null;
  },
): PrintContext {
  return demoPrintContext({
    documentType: asDocumentKind(template.documentType),
    locale: opts.locale,
    currency: opts.currency,
    vatRate: opts.vatRate,
    logoUrl: opts.logoUrl,
    companyName: opts.companyName,
    industrySlug: opts.industrySlug,
  });
}

/** Sync render + memoize. Returns null when the template has nothing to render. */
export function getTemplatePreviewHtml(
  template: DocumentTemplate,
  ctx: PrintContext,
  documentStyle?: DocumentStyle | null,
): string | null {
  const styleVersion = documentStyle ? JSON.stringify(documentStyle) : "";
  const key = `${templatePreviewCacheKey(template, styleVersion)}::${ctx.documentKind}::${ctx.locale}::${ctx.currency}`;
  const cached = previewHtmlCache.get(key);
  if (cached != null) return cached || null;
  const html = renderTemplateDocument(template, ctx, documentStyle);
  previewHtmlCache.set(key, html ?? "");
  return html;
}
