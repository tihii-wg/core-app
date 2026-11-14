import { describe, expect, it } from "vitest";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { defaultCanvasLayoutForType } from "./canvas/defaultCanvasLayouts";
import { clearTemplatePreviewHtmlCache, templatePreviewCacheKey } from "./templatePreviewHtml";

describe("templatePreviewCacheKey", () => {
  it("changes when layout is updated after save", () => {
    clearTemplatePreviewHtmlCache();
    const base: DocumentTemplate = {
      id: "t1",
      workspaceId: "ws",
      name: "WO",
      documentType: "work_order",
      widthMm: null,
      heightMm: null,
      showCents: true,
      isAvailableToAll: true,
      isActive: true,
      isDefault: true,
      layout: defaultCanvasLayoutForType("work_order"),
      style: null,
      bodyHtml: "<div>a</div>",
    };
    const before = templatePreviewCacheKey(base);
    const afterSave: DocumentTemplate = {
      ...base,
      bodyHtml: "<div>b</div>",
      layout: {
        ...base.layout!,
        page: { ...base.layout!.page, marginsMm: 20 },
      } as DocumentTemplate["layout"],
    };
    expect(templatePreviewCacheKey(afterSave)).not.toBe(before);
  });
});
