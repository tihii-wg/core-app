import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { renderTemplateDocument } from "../../services/apiDocumentTemplates";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { demoPrintContext } from "./demoPrintContext";
import {
  defaultActLayout,
  defaultInvoiceLayout,
  defaultWorkOrderLayout,
} from "./defaultLayouts";
import {
  defaultCanvasActLayout,
  defaultCanvasInvoiceLayout,
  defaultCanvasWorkOrderLayout,
} from "./canvas/defaultCanvasLayouts";
import { collectTemplateTokensFromSource } from "./templateTokenScan";
import {
  findUnresolvedTemplateTokens,
  knownTemplateTokens,
  visibleTemplateVariables,
} from "./templateVariables";

const LOCALES = ["en", "ro", "ru"] as const;
const DOCUMENT_TYPES = ["work_order", "act", "invoice"] as const;

function blockLayoutFor(type: (typeof DOCUMENT_TYPES)[number]) {
  if (type === "act") return defaultActLayout();
  if (type === "invoice") return defaultInvoiceLayout();
  return defaultWorkOrderLayout();
}

function canvasLayoutFor(type: (typeof DOCUMENT_TYPES)[number], locale: string) {
  const t = i18n.getFixedT(locale);
  if (type === "act") return defaultCanvasActLayout(t);
  if (type === "invoice") return defaultCanvasInvoiceLayout(t);
  return defaultCanvasWorkOrderLayout(t);
}

function asTemplate(
  layout: DocumentTemplate["layout"],
  documentType: (typeof DOCUMENT_TYPES)[number],
): DocumentTemplate {
  return {
    id: `default-${documentType}`,
    workspaceId: "ws",
    name: documentType,
    documentType,
    widthMm: 210,
    heightMm: 297,
    showCents: true,
    isAvailableToAll: true,
    isActive: true,
    isDefault: true,
    layout,
    style: null,
    bodyHtml: "",
  };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("default template tokens", () => {
  it("every #TOKEN in block and canvas defaults exists in the registry", () => {
    const known = knownTemplateTokens();
    const missing: string[] = [];

    for (const documentType of DOCUMENT_TYPES) {
      for (const token of collectTemplateTokensFromSource(blockLayoutFor(documentType))) {
        if (!known.has(token)) missing.push(`block/${documentType}:${token}`);
      }
      for (const locale of LOCALES) {
        for (const token of collectTemplateTokensFromSource(canvasLayoutFor(documentType, locale))) {
          if (!known.has(token)) missing.push(`canvas/${documentType}/${locale}:${token}`);
        }
      }
    }

    expect(missing, missing.join(", ")).toEqual([]);
  });

  it("rendering every default template with demo data leaves no raw # tokens", () => {
    const leftovers: string[] = [];

    for (const documentType of DOCUMENT_TYPES) {
      for (const locale of LOCALES) {
        const ctx = demoPrintContext({
          documentType,
          locale,
          currency: "MDL",
          vatRate: 20,
          now: new Date("2026-11-07T12:00:00.000Z"),
        });

        for (const layout of [blockLayoutFor(documentType), canvasLayoutFor(documentType, locale)]) {
          const html = renderTemplateDocument(asTemplate(layout, documentType), ctx);
          expect(html).toBeTruthy();
          const unresolved = findUnresolvedTemplateTokens(html ?? "");
          if (unresolved.length) {
            leftovers.push(`${documentType}/${locale}: ${unresolved.join(" ")}`);
          }
        }
      }
    }

    expect(leftovers, leftovers.join("\n")).toEqual([]);
  });

  it("hides back-compat aliases from the variable picker list", () => {
    const visible = new Set(visibleTemplateVariables().map((v) => v.token));
    expect(visible.has("#СЧЁТ-СРОК-ОПЛАТЫ")).toBe(true);
    expect(visible.has("#СЧЁТ-СРОК")).toBe(false);
    expect(visible.has("#КОМПАНИЯ-ТЕЛЕФОН")).toBe(true);
  });
});
