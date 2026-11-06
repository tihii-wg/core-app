import { describe, expect, it } from "vitest";
import { applyCommonStyleToLayout } from "./applyCommonStyle";
import { createLayoutFromTemplate } from "./createFromTemplate";
import { defaultActLayout, defaultInvoiceLayout, defaultWorkOrderLayout } from "./defaultLayouts";
import {
  defaultDocumentStyle,
  isColorRef,
  isDocumentStyle,
  parseDocumentStyle,
  resolveColorRef,
  themeRef,
} from "./documentStyle";
import {
  documentStyleToRenderStyle,
  renderTemplateDocument,
  resolveDocumentStyle,
  toDocumentTemplate,
} from "../../services/apiDocumentTemplates";
import { isDocumentLayout, renderLayoutToHtml } from "./layout";
import { emptyPrintContext } from "./templateVariables";
import type { InvoiceDocument, Order } from "../../lib/types";

const orderStub: Order = {
  id: "o1",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "ORD-1",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [{ id: "s1", serviceId: "svc", serviceName: "Labour", price: 100, quantity: 1 }],
  materials: [],
  description: "",
  status: "new",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 100,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const invoiceStub: InvoiceDocument = {
  id: "inv1",
  workspaceId: "ws1",
  invoiceNumber: "INV-1",
  clientId: "c1",
  clientName: "Ada",
  clientPhone: "",
  orderId: "o1",
  orderNumber: "ORD-1",
  device: "",
  carNumber: "",
  vin: "",
  description: "",
  subtotal: 100,
  amount: 100,
  total: 100,
  status: "sent",
  dueDate: "2026-02-01",
  createdAt: "2026-01-20T10:00:00.000Z",
  updatedAt: "2026-01-20T10:00:00.000Z",
  items: [{ id: "w1", invoiceId: "inv1", serviceId: "s1", serviceName: "Labour", price: 100, quantity: 1, position: 0, createdAt: "" }],
};

describe("DocumentStyle", () => {
  it("accepts hex and theme ColorRefs; rejects unsafe colors", () => {
    expect(isColorRef("#1a6de0")).toBe(true);
    expect(isColorRef("theme:primary")).toBe(true);
    expect(isColorRef("red")).toBe(false);
    expect(isColorRef("theme:neon")).toBe(false);
    const style = defaultDocumentStyle();
    expect(isDocumentStyle(style)).toBe(true);
    expect(resolveColorRef(themeRef("primary"), style.colors)).toBe(style.colors.primary);
    expect(parseDocumentStyle({ ...style, colors: { ...style.colors, primary: "nope" } })).toBeNull();
  });

  it("resolves theme refs when rendering", () => {
    const style = defaultDocumentStyle();
    style.colors.primary = "#112233";
    const layout = defaultInvoiceLayout();
    const html = renderLayoutToHtml(
      layout,
      emptyPrintContext({
        invoice: invoiceStub,
        documentKind: "invoice",
        invoiceSections: { works: invoiceStub.items, materials: [], worksSubtotal: 100, materialsSubtotal: 0, grandTotal: 100 },
      }),
      { style: documentStyleToRenderStyle(style) },
    );
    expect(html).toContain("#112233");
  });

  it("renders styleHeader/styleFooter for invoice, act, and work order", () => {
    const style = documentStyleToRenderStyle(defaultDocumentStyle());
    for (const [kind, layout] of [
      ["invoice", defaultInvoiceLayout()],
      ["act", defaultActLayout()],
      ["work_order", defaultWorkOrderLayout()],
    ] as const) {
      expect(layout.blocks.some((block) => block.kind === "styleHeader")).toBe(true);
      expect(layout.blocks.some((block) => block.kind === "styleFooter")).toBe(true);
      const ctx = emptyPrintContext({
        documentKind: kind,
        order: orderStub,
        invoice: kind === "invoice" ? invoiceStub : null,
        invoiceSections:
          kind === "invoice"
            ? { works: invoiceStub.items, materials: [], worksSubtotal: 100, materialsSubtotal: 0, grandTotal: 100 }
            : null,
        locale: "en",
      });
      const html = renderLayoutToHtml(layout, ctx, { style });
      expect(html.length).toBeGreaterThan(20);
      expect(html).toMatch(/Payment invoice|Act of completed works|Work order|docTitle/);
    }
  });

  it("resolves #ДОКУМЕНТ-* per document kind", () => {
    const style = documentStyleToRenderStyle(defaultDocumentStyle());
    const layout = defaultWorkOrderLayout();
    const wo = renderLayoutToHtml(layout, emptyPrintContext({ documentKind: "work_order", order: orderStub, locale: "en" }), {
      style,
    });
    expect(wo).toMatch(/Work order|docTitleWorkOrder/);
    expect(wo).toContain("ORD-1");

    const inv = renderLayoutToHtml(
      defaultInvoiceLayout(),
      emptyPrintContext({ documentKind: "invoice", invoice: invoiceStub, locale: "en" }),
      { style },
    );
    expect(inv).toMatch(/Payment invoice|docTitleInvoice/);
    expect(inv).toContain("INV-1");
  });

  it("changing a style color changes all three rendered documents", () => {
    const base = defaultDocumentStyle();
    const changed = { ...base, colors: { ...base.colors, primary: "#abcdef" } };
    const baseStyle = documentStyleToRenderStyle(base);
    const nextStyle = documentStyleToRenderStyle(changed);
    const ctxWo = emptyPrintContext({ documentKind: "work_order", order: orderStub, locale: "en" });
    const ctxAct = emptyPrintContext({ documentKind: "act", order: orderStub, locale: "en" });
    const ctxInv = emptyPrintContext({
      documentKind: "invoice",
      invoice: invoiceStub,
      invoiceSections: { works: invoiceStub.items, materials: [], worksSubtotal: 100, materialsSubtotal: 0, grandTotal: 100 },
      locale: "en",
    });
    expect(renderLayoutToHtml(defaultWorkOrderLayout(), ctxWo, { style: nextStyle })).toContain("#abcdef");
    expect(renderLayoutToHtml(defaultActLayout(), ctxAct, { style: nextStyle })).toContain("#abcdef");
    expect(renderLayoutToHtml(defaultInvoiceLayout(), ctxInv, { style: nextStyle })).toContain("#abcdef");
    expect(renderLayoutToHtml(defaultWorkOrderLayout(), ctxWo, { style: baseStyle })).not.toContain("#abcdef");
  });

  it("create from template maps sources/tokens and reports unmapped ones", () => {
    const source = defaultInvoiceLayout();
    // Inject an unmappable invoice-only token in a text block.
    source.blocks.push({
      id: "x",
      kind: "text",
      enabled: true,
      html: "<p>#СЧЁТ-СРОК-ОПЛАТЫ #UNKNOWN-TOKEN</p>",
    });
    const { layout, unmappedTokens } = createLayoutFromTemplate(source, "invoice", "work_order");
    expect(isDocumentLayout(layout)).toBe(true);
    const tables = layout.blocks.filter((block) => block.kind === "table");
    expect(tables.some((block) => block.kind === "table" && block.source === "services")).toBe(true);
    expect(unmappedTokens).toContain("#UNKNOWN-TOKEN");
    expect(unmappedTokens).toContain("#СЧЁТ-СРОК-ОПЛАТЫ");
  });

  it("falls back to built-in style when the row is missing/invalid", () => {
    expect(resolveDocumentStyle(null).colors.primary).toBe(defaultDocumentStyle().colors.primary);
    expect(resolveDocumentStyle({ version: 1 } as never).version).toBe(1);
  });

  it("legacy layouts without useStyle still render without shared style chrome", () => {
    const legacy = { ...defaultWorkOrderLayout(), useStyle: undefined };
    // Strip style slots so legacy content is self-contained.
    legacy.blocks = legacy.blocks.filter((block) => block.kind !== "styleHeader" && block.kind !== "styleFooter");
    legacy.blocks.unshift({
      id: "legacy_title",
      kind: "documentTitle",
      enabled: true,
      text: "LEGACY_TITLE",
    });
    const html = renderLayoutToHtml(legacy, emptyPrintContext({ order: orderStub }));
    expect(html).toContain("LEGACY_TITLE");
    expect(html).not.toContain(defaultDocumentStyle().colors.primary);
  });

  it("applyCommonStyleToLayout sets useStyle and theme refs for default hex", () => {
    const layout = applyCommonStyleToLayout({
      version: 2,
      page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
      blocks: [
        {
          id: "b1",
          kind: "fields",
          enabled: true,
          style: { background: defaultDocumentStyle().colors.primary, titleColor: "#ff0000" },
          fields: [{ label: "A", template: "#КЛИЕНТ-ИМЯ", enabled: true }],
        },
      ],
    });
    expect(layout.useStyle).toBe(true);
    expect(layout.blocks[0]?.kind === "fields" && layout.blocks[0].style?.background).toBe("theme:primary");
    expect(layout.blocks[0]?.kind === "fields" && layout.blocks[0].style?.titleColor).toBe("#ff0000");
  });

  it("renderTemplateDocument uses style for useStyle layouts", () => {
    const template = toDocumentTemplate({
      id: "t1",
      workspace_id: "ws",
      name: "WO",
      document_type: "work_order",
      body_html: "",
      layout: defaultWorkOrderLayout(),
      is_default: true,
      show_cents: true,
      is_available_to_all: true,
      is_active: true,
    });
    const html = renderTemplateDocument(
      template,
      emptyPrintContext({ documentKind: "work_order", order: orderStub, locale: "en" }),
      defaultDocumentStyle(),
    );
    expect(html).toMatch(/Work order|docTitleWorkOrder/);
    expect(html).toContain("ORD-1");
  });
});
