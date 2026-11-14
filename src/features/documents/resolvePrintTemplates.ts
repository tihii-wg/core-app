/**
 * Resolves printable templates for a document type: active custom templates, or a built-in default.
 * Built-ins are not stored in the DB — they render from defaultCanvasLayoutForType.
 */

import type { TFunction } from "i18next";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { defaultCanvasLayoutForType } from "./canvas/defaultCanvasLayouts";
import type { DocumentTemplateType } from "./layout";
import { renderCanvasLayoutToHtml, renderCanvasLayoutToHtmlSync } from "./canvas/renderCanvasLayout";
import { canvasPageCss } from "./canvas/renderCanvasLayout";
import type { DocumentStyle } from "./documentStyle";
import { fontFamilyCss } from "./documentStyle";
import { buildPrintDocument } from "./printTemplate";
import type { PrintContext } from "./templateVariables";

export const BUILTIN_TEMPLATE_PREFIX = "builtin:";

export type PrintTemplateChoice = {
  id: string;
  name: string;
  documentType: DocumentTemplateType;
  isDefault: boolean;
  isBuiltin: boolean;
};

export function builtinTemplateId(documentType: DocumentTemplateType): string {
  return `${BUILTIN_TEMPLATE_PREFIX}${documentType}`;
}

export function parseBuiltinTemplateId(id: string): DocumentTemplateType | null {
  if (!id.startsWith(BUILTIN_TEMPLATE_PREFIX)) return null;
  const type = id.slice(BUILTIN_TEMPLATE_PREFIX.length);
  if (type === "work_order" || type === "act" || type === "invoice" || type === "estimate") return type;
  return null;
}

export function isBuiltinTemplateId(id: string): boolean {
  return parseBuiltinTemplateId(id) != null;
}

export function standardTemplateName(documentType: DocumentTemplateType, t: TFunction): string {
  switch (documentType) {
    case "act":
      return t("settings.printTemplates.standardAct");
    case "invoice":
      return t("settings.printTemplates.standardInvoice");
    case "estimate":
      return t("settings.printTemplates.standardEstimate");
    default:
      return t("settings.printTemplates.standardWorkOrder");
  }
}

function isPrintableStored(template: DocumentTemplate, documentType: DocumentTemplateType): boolean {
  return (
    template.isActive &&
    template.documentType === documentType &&
    (Boolean(template.layout) || Boolean(template.bodyHtml.trim()))
  );
}

/** Active customs for one type, or a single built-in default. */
export function resolvePrintTemplatesForType(
  templates: DocumentTemplate[],
  documentType: DocumentTemplateType,
  t: TFunction,
): PrintTemplateChoice[] {
  const custom = templates
    .filter((template) => isPrintableStored(template, documentType))
    .slice()
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  if (custom.length > 0) {
    return custom.map((template) => ({
      id: template.id,
      name: template.name,
      documentType,
      isDefault: template.isDefault,
      isBuiltin: false,
    }));
  }
  return [
    {
      id: builtinTemplateId(documentType),
      name: standardTemplateName(documentType, t),
      documentType,
      isDefault: true,
      isBuiltin: true,
    },
  ];
}

/**
 * Order/estimate print menu: prefer matching customs across allowed types;
 * if none, offer a built-in for each allowed type.
 */
export function resolvePrintTemplatesForOrder(
  templates: DocumentTemplate[],
  isEstimate: boolean,
  t: TFunction,
): PrintTemplateChoice[] {
  const types: DocumentTemplateType[] = isEstimate ? ["estimate", "work_order"] : ["work_order", "act"];
  const customs = templates
    .filter(
      (template) =>
        template.isActive &&
        types.includes(template.documentType as DocumentTemplateType) &&
        (Boolean(template.layout) || Boolean(template.bodyHtml.trim())),
    )
    .slice()
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  if (customs.length > 0) {
    return customs.map((template) => ({
      id: template.id,
      name: template.name,
      documentType: template.documentType as DocumentTemplateType,
      isDefault: template.isDefault,
      isBuiltin: false,
    }));
  }
  return types.map((documentType) => ({
    id: builtinTemplateId(documentType),
    name: standardTemplateName(documentType, t),
    documentType,
    isDefault: documentType === types[0],
    isBuiltin: true,
  }));
}

export function resolvePrintTemplatesForInvoice(
  templates: DocumentTemplate[],
  t: TFunction,
): PrintTemplateChoice[] {
  return resolvePrintTemplatesForType(templates, "invoice", t);
}

/** Synthetic DocumentTemplate for designer/settings cards (not persisted). */
export function builtinAsDocumentTemplate(
  documentType: DocumentTemplateType,
  t: TFunction,
  workspaceId = "",
): DocumentTemplate {
  const layout = defaultCanvasLayoutForType(documentType, t);
  return {
    id: builtinTemplateId(documentType),
    workspaceId,
    name: standardTemplateName(documentType, t),
    documentType,
    widthMm: null,
    heightMm: null,
    showCents: true,
    isAvailableToAll: true,
    isActive: true,
    isDefault: true,
    layout,
    style: null,
    bodyHtml: "",
  };
}

function styleColors(documentStyle?: DocumentStyle | null) {
  try {
    // Prefer workspace style colors when useStyle-like rendering.
    return documentStyle?.colors ?? null;
  } catch {
    return null;
  }
}

/** Render a built-in canvas default to a full print HTML document. */
export function renderBuiltinTemplateDocument(
  documentType: DocumentTemplateType,
  ctx: PrintContext,
  t: TFunction,
  documentStyle?: DocumentStyle | null,
): string {
  const layout = defaultCanvasLayoutForType(documentType, t);
  const colors = layout.useStyle === true ? styleColors(documentStyle) : null;
  const body = renderCanvasLayoutToHtmlSync(layout, { ...ctx, documentKind: documentType }, {
    showCents: true,
    colors,
  });
  const font =
    layout.useStyle === true && documentStyle?.font?.family
      ? fontFamilyCss(documentStyle.font.family)
      : undefined;
  return buildPrintDocument(body, standardTemplateName(documentType, t), canvasPageCss(layout, font));
}

export async function renderBuiltinTemplateDocumentAsync(
  documentType: DocumentTemplateType,
  ctx: PrintContext,
  t: TFunction,
  documentStyle?: DocumentStyle | null,
): Promise<string> {
  const layout = defaultCanvasLayoutForType(documentType, t);
  const colors = layout.useStyle === true ? styleColors(documentStyle) : null;
  const body = await renderCanvasLayoutToHtml(layout, { ...ctx, documentKind: documentType }, {
    showCents: true,
    colors,
  });
  const font =
    layout.useStyle === true && documentStyle?.font?.family
      ? fontFamilyCss(documentStyle.font.family)
      : undefined;
  return buildPrintDocument(body, standardTemplateName(documentType, t), canvasPageCss(layout, font));
}
