import { describe, expect, it } from "vitest";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { defaultCanvasLayoutForType } from "./canvas/defaultCanvasLayouts";
import {
  builtinTemplateId,
  isBuiltinTemplateId,
  parseBuiltinTemplateId,
  resolvePrintTemplatesForInvoice,
  resolvePrintTemplatesForOrder,
  resolvePrintTemplatesForType,
  standardTemplateName,
} from "./resolvePrintTemplates";

const t = ((key: string) => key) as unknown as import("i18next").TFunction;

function template(partial: Partial<DocumentTemplate> & Pick<DocumentTemplate, "id" | "documentType">): DocumentTemplate {
  return {
    workspaceId: "ws",
    name: partial.name ?? partial.id,
    widthMm: null,
    heightMm: null,
    showCents: true,
    isAvailableToAll: true,
    isActive: partial.isActive ?? true,
    isDefault: partial.isDefault ?? false,
    layout: partial.layout ?? defaultCanvasLayoutForType(partial.documentType as import("./layout").DocumentTemplateType),
    style: null,
    bodyHtml: partial.bodyHtml ?? "<div/>",
    ...partial,
  };
}

describe("resolvePrintTemplates", () => {
  it("offers built-in per type when no customs", () => {
    const choices = resolvePrintTemplatesForType([], "work_order", t);
    expect(choices).toEqual([
      {
        id: "builtin:work_order",
        name: "settings.printTemplates.standardWorkOrder",
        documentType: "work_order",
        isDefault: true,
        isBuiltin: true,
      },
    ]);
    expect(isBuiltinTemplateId(choices[0]!.id)).toBe(true);
    expect(parseBuiltinTemplateId(choices[0]!.id)).toBe("work_order");
  });

  it("lists customs when present and prefers default", () => {
    const customs = [
      template({ id: "a", documentType: "act", name: "A", isDefault: false }),
      template({ id: "b", documentType: "act", name: "B", isDefault: true }),
    ];
    const choices = resolvePrintTemplatesForType(customs, "act", t);
    expect(choices.map((c) => c.id)).toEqual(["b", "a"]);
    expect(choices.every((c) => !c.isBuiltin)).toBe(true);
  });

  it("falls back to built-in when customs are inactive", () => {
    const inactive = [template({ id: "x", documentType: "invoice", isActive: false })];
    const choices = resolvePrintTemplatesForInvoice(inactive, t);
    expect(choices[0]?.id).toBe(builtinTemplateId("invoice"));
  });

  it("maps order vs estimate document types", () => {
    const order = resolvePrintTemplatesForOrder([], false, t);
    expect(order.map((c) => c.documentType)).toEqual(["work_order", "act"]);
    const estimate = resolvePrintTemplatesForOrder([], true, t);
    expect(estimate.map((c) => c.documentType)).toEqual(["estimate", "work_order"]);
  });

  it("translates standard names via i18n keys", () => {
    expect(standardTemplateName("estimate", t)).toBe("settings.printTemplates.standardEstimate");
    expect(standardTemplateName("invoice", t)).toBe("settings.printTemplates.standardInvoice");
  });
});
