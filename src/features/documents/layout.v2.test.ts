import { describe, expect, it } from "vitest";
import { documentStyleToRenderStyle } from "../../services/apiDocumentTemplates";
import type { InvoiceDocument } from "../../lib/types";
import { DEFAULT_INVOICE_SECTION_ORDER, defaultInvoiceLayout, defaultWorkOrderLayout } from "./defaultLayouts";
import { defaultDocumentStyle } from "./documentStyle";
import {
  isDocumentLayout,
  isSafeHexColor,
  migrateLayoutToV2,
  parseDocumentLayout,
  renderLayoutToHtml,
  type DocumentLayout,
} from "./layout";
import { emptyPrintContext } from "./templateVariables";

const invoice: InvoiceDocument = {
  id: "inv1",
  workspaceId: "ws1",
  invoiceNumber: "INV-9",
  clientId: "c1",
  clientName: "Buyer Co",
  clientPhone: "+373",
  orderId: "o1",
  orderNumber: "ORD-9",
  device: "Sedan",
  carNumber: "ABC",
  vin: "VIN9",
  description: "Notes here",
  subtotal: 200,
  amount: 200,
  total: 200,
  status: "sent",
  dueDate: "2026-02-01",
  createdAt: "2026-01-20T10:00:00.000Z",
  updatedAt: "2026-01-20T10:00:00.000Z",
  items: [
    { id: "w1", invoiceId: "inv1", serviceId: "s1", serviceName: "Labour", price: 100, quantity: 1, position: 0, createdAt: "" },
    { id: "m1", invoiceId: "inv1", serviceId: null, serviceName: "Oil", price: 50, quantity: 2, position: 1, createdAt: "" },
  ],
};

describe("layout v2", () => {
  it("migrates v1 to v2 while rendering identically for work order defaults", () => {
    const v1 = { ...defaultWorkOrderLayout(), version: 1 as const };
    expect(isDocumentLayout(v1)).toBe(true);
    const v2 = migrateLayoutToV2(v1);
    expect(v2.version).toBe(2);
    const ctx = emptyPrintContext({ locale: "en" });
    expect(renderLayoutToHtml(v1, ctx)).toBe(renderLayoutToHtml(v2, ctx));
  });

  it("renders columns with width percentages", () => {
    const layout: DocumentLayout = {
      version: 2,
      page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
      blocks: [
        {
          id: "cols",
          kind: "columns",
          enabled: true,
          gapMm: 4,
          columns: [
            {
              id: "c1",
              widthPercent: 40,
              blocks: [{ id: "t1", kind: "text", enabled: true, html: "<p>LEFT</p>" }],
            },
            {
              id: "c2",
              widthPercent: 60,
              blocks: [{ id: "t2", kind: "text", enabled: true, html: "<p>RIGHT</p>" }],
            },
          ],
        },
      ],
    };
    const html = renderLayoutToHtml(layout, emptyPrintContext());
    expect(html).toContain("flex:0 0 40%");
    expect(html).toContain("flex:0 0 60%");
    expect(html).toContain("LEFT");
    expect(html).toContain("RIGHT");
  });

  it("rejects nested columns", () => {
    const nested = {
      version: 2,
      page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
      blocks: [
        {
          id: "outer",
          kind: "columns",
          enabled: true,
          columns: [
            {
              id: "c1",
              widthPercent: 50,
              blocks: [
                {
                  id: "inner",
                  kind: "columns",
                  enabled: true,
                  columns: [
                    { id: "i1", widthPercent: 50, blocks: [] },
                    { id: "i2", widthPercent: 50, blocks: [] },
                  ],
                },
              ],
            },
            { id: "c2", widthPercent: 50, blocks: [] },
          ],
        },
      ],
    };
    expect(isDocumentLayout(nested)).toBe(false);
    expect(parseDocumentLayout(nested)).toBeNull();
  });

  it("style whitelist accepts only hex colors", () => {
    expect(isSafeHexColor("#1a6de0")).toBe(true);
    expect(isSafeHexColor("#fff")).toBe(true);
    expect(isSafeHexColor("red")).toBe(false);
    expect(isSafeHexColor("url(x)")).toBe(false);
    const bad = {
      version: 2,
      page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
      blocks: [
        {
          id: "t",
          kind: "text",
          enabled: true,
          html: "<p>x</p>",
          style: { background: "javascript:alert(1)" },
        },
      ],
    };
    // Invalid style colors are stripped; layout still valid.
    const parsed = parseDocumentLayout(bad);
    expect(parsed).not.toBeNull();
    expect(parsed?.blocks[0] && "style" in parsed.blocks[0] ? parsed.blocks[0].style?.background : "no").toBeUndefined();
  });

  it("renders field value templates with several tokens and hides empty rows", () => {
    const layout: DocumentLayout = {
      version: 2,
      page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
      blocks: [
        {
          id: "f",
          kind: "fields",
          enabled: true,
          fields: [
            { label: "Vehicle", template: "#СЧЁТ-НОМЕР-АВТО #СЧЁТ-VIN", enabled: true, hideIfEmpty: true },
            { label: "Missing", template: "#СЧЁТ-ОПЛАЧЕН", enabled: true, hideIfEmpty: true },
          ],
        },
      ],
    };
    const html = renderLayoutToHtml(
      layout,
      emptyPrintContext({
        invoice,
        invoiceSections: {
          works: [invoice.items[0]!],
          materials: [invoice.items[1]!],
          worksSubtotal: 100,
          materialsSubtotal: 100,
          grandTotal: 200,
        },
      }),
    );
    expect(html).toContain("ABC");
    expect(html).toContain("VIN9");
    expect(html).not.toContain("Missing");
  });

  it("default invoice layout contains all InvoicePrintDocument sections in order", () => {
    const layout = defaultInvoiceLayout();
    expect(layout.version).toBe(2);
    expect(layout.useStyle).toBe(true);
    const ids = layout.blocks.map((block) => block.id);
    expect(ids).toEqual([...DEFAULT_INVOICE_SECTION_ORDER]);
    const html = renderLayoutToHtml(
      layout,
      emptyPrintContext({
        invoice,
        documentKind: "invoice",
        invoiceSections: {
          works: [invoice.items[0]!],
          materials: [invoice.items[1]!],
          worksSubtotal: 100,
          materialsSubtotal: 100,
          grandTotal: 200,
        },
        legalEntity: {
          id: "le",
          workspaceId: "ws",
          legalName: "FixFlow SRL",
          address: "Str. 1",
          registrationNumber: "REG",
          taxNumber: "TAX",
          billingEmail: "a@b.c",
          iban: "MD00",
          bankName: "Bank",
          bankCode: "BIC",
          additionalInfo: "",
          isDefault: true,
        },
        currency: "MDL",
        locale: "en",
      }),
      { style: documentStyleToRenderStyle(defaultDocumentStyle()) },
    );
    const markers = ["Payment invoice", "INV-9", "Supplier", "Customer", "Works", "Materials", "Payment details", "not a fiscal"];
    let last = -1;
    for (const marker of markers) {
      const idx = html.indexOf(marker);
      expect(idx, marker).toBeGreaterThan(last);
      last = idx;
    }
    expect(html).toContain("Labour");
    expect(html).toContain("Oil");
    expect(html).toContain("FixFlow SRL");
    expect(html).toContain("Buyer Co");
  });
});
