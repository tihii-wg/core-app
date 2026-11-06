import { describe, expect, it } from "vitest";
import { defaultActLayout, defaultInvoiceLayout, defaultWorkOrderLayout } from "./defaultLayouts";
import {
  isDocumentLayout,
  parseDocumentLayout,
  renderLayoutToHtml,
  type DocumentLayout,
  type TableBlock,
} from "./layout";
import { emptyPrintContext } from "./templateVariables";
import type { InvoiceDocument, Order } from "../../lib/types";

const fullOrder: Order = {
  id: "o1",
  clientId: "c1",
  clientName: "Ada Lovelace",
  clientPhone: "+373",
  orderNumber: "ORD-1",
  device: "",
  vin: "VIN1",
  carNumber: "ABC123",
  service: "",
  services: [
    {
      id: "s1",
      serviceId: "svc1",
      serviceName: "Oil change",
      price: 100,
      quantity: 1,
      discountType: "percent",
      discountValue: 10,
      warrantyMonths: 6,
    },
  ],
  materials: [
    {
      id: "m1",
      itemName: "Filter",
      price: 50,
      quantity: 2,
      discountType: null,
      discountValue: null,
      warrantyMonths: null,
    },
  ],
  description: "Service visit",
  status: "new",
  assignedEmployeeId: "",
  assignedEmployeeName: "Bob",
  deadline: "",
  totalPrice: 190,
  discountTotal: 10,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-01-15T10:00:00.000Z",
  updatedAt: "2026-01-15T10:00:00.000Z",
};

const fullInvoice: InvoiceDocument = {
  id: "inv1",
  workspaceId: "ws1",
  invoiceNumber: "INV-1",
  clientId: "c1",
  clientName: "Ada Lovelace",
  clientPhone: "+373",
  orderId: "o1",
  orderNumber: "ORD-1",
  device: "",
  carNumber: "ABC123",
  vin: "VIN1",
  description: "",
  subtotal: 200,
  amount: 200,
  total: 200,
  status: "sent",
  dueDate: "2026-02-01",
  createdAt: "2026-01-20T10:00:00.000Z",
  updatedAt: "2026-01-20T10:00:00.000Z",
  items: [{ id: "li1", invoiceId: "inv1", serviceId: null, serviceName: "Labour", price: 100, quantity: 2, position: 0, createdAt: "2026-01-20T10:00:00.000Z" }],
};

describe("isDocumentLayout", () => {
  it("accepts a valid versioned layout", () => {
    expect(isDocumentLayout(defaultWorkOrderLayout())).toBe(true);
    expect(isDocumentLayout(defaultActLayout())).toBe(true);
    expect(isDocumentLayout(defaultInvoiceLayout())).toBe(true);
  });

  it("rejects invalid JSON shapes", () => {
    expect(isDocumentLayout(null)).toBe(false);
    expect(isDocumentLayout({})).toBe(false);
    expect(isDocumentLayout({ version: 2, page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 }, blocks: [] })).toBe(false);
    expect(isDocumentLayout({ version: 1, page: { size: "A3", orientation: "portrait", marginsMm: 10, fontSizePt: 10 }, blocks: [] })).toBe(false);
    expect(
      isDocumentLayout({
        version: 1,
        page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
        blocks: [{ id: "x", kind: "unknown", enabled: true }],
      }),
    ).toBe(false);
    expect(parseDocumentLayout({ version: 1 })).toBeNull();
  });
});

describe("renderLayoutToHtml", () => {
  it("renders each block kind on a full context and escapes text", () => {
    const layout: DocumentLayout = {
      version: 1,
      page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
      blocks: [
        {
          id: "1",
          kind: "companyHeader",
          enabled: true,
          align: "left",
          fields: [{ token: "#КОМПАНИЯ-НАЗВАНИЕ", label: "Co", enabled: true }],
        },
        { id: "2", kind: "documentTitle", enabled: true, text: "Order #ЗАКАЗ-НОМЕР <b>" },
        {
          id: "3",
          kind: "fields",
          enabled: true,
          title: "Client",
          fields: [{ token: "#КЛИЕНТ-ИМЯ", label: "Name", enabled: true }],
        },
        {
          id: "4",
          kind: "table",
          enabled: true,
          source: "services",
          showTotalsRow: true,
          columns: [
            { key: "index", label: "№", enabled: true },
            { key: "name", label: "Name", enabled: true },
            { key: "sku", label: "SKU", enabled: false },
            { key: "sum", label: "Итого", enabled: true },
          ],
        },
        {
          id: "5",
          kind: "totals",
          enabled: true,
          rows: [
            { key: "total", label: "Total", enabled: true },
            { key: "totalWords", label: "Words", enabled: true },
          ],
        },
        { id: "6", kind: "warranty", enabled: true },
        { id: "7", kind: "text", enabled: true, html: "<p>Hello #КЛИЕНТ-ИМЯ</p>" },
        { id: "8", kind: "signatures", enabled: true, labels: ["A", "B"] },
        { id: "9", kind: "spacer", enabled: true, heightMm: 5 },
        { id: "10", kind: "divider", enabled: true },
      ],
    };
    const html = renderLayoutToHtml(
      layout,
      emptyPrintContext({
        order: fullOrder,
        client: {
          id: "c1",
          name: "Ada <script>",
          email: "",
          phone: "",
          address: "",
          balance: 0,
          created_at: "",
          client_type: "individual",
          tax_id: null,
          contact_person: null,
        },
        currency: "MDL",
        locale: "ru",
        paymentBalance: {
          total: 190,
          netPaid: 50,
          remaining: 140,
          overpayment: 0,
          status: "partial",
          hasLedger: true,
          isLegacyUnreconciled: false,
        },
      }),
    );
    expect(html).toContain("ORD-1");
    expect(html).toContain("Ada &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Итого");
    expect(html).not.toContain(">SKU<");
    expect(html).toContain("Oil change");
    expect(html).toContain("Hello");
  });

  it("renders safely on empty context", () => {
    const html = renderLayoutToHtml(defaultWorkOrderLayout(), emptyPrintContext());
    expect(html).toContain("Заказ-наряд");
    expect(html).not.toContain("undefined");
  });

  it("respects column order and disabled columns", () => {
    const table: TableBlock = {
      id: "t",
      kind: "table",
      enabled: true,
      source: "services",
      showTotalsRow: false,
      columns: [
        { key: "sum", label: "Итого", enabled: true },
        { key: "name", label: "Name", enabled: true },
        { key: "sku", label: "SKU", enabled: false },
        { key: "index", label: "№", enabled: true },
      ],
    };
    const layout: DocumentLayout = {
      version: 1,
      page: { size: "A4", orientation: "portrait", marginsMm: 10, fontSizePt: 10 },
      blocks: [table],
    };
    const html = renderLayoutToHtml(layout, emptyPrintContext({ order: fullOrder, currency: "MDL" }));
    const idxSum = html.indexOf(">Итого<");
    const idxName = html.indexOf(">Name<");
    const idxIndex = html.indexOf(">№<");
    expect(idxSum).toBeGreaterThan(-1);
    expect(idxName).toBeGreaterThan(idxSum);
    expect(idxIndex).toBeGreaterThan(idxName);
    expect(html).not.toContain(">SKU<");
  });

  it("renders default layouts for order and invoice", () => {
    const orderHtml = renderLayoutToHtml(defaultWorkOrderLayout(), emptyPrintContext({ order: fullOrder, currency: "MDL", locale: "ru" }));
    expect(orderHtml).toContain("ORD-1");
    expect(orderHtml).toContain("Oil change");
    const invoiceHtml = renderLayoutToHtml(
      defaultInvoiceLayout(),
      emptyPrintContext({ invoice: fullInvoice, order: fullOrder, currency: "MDL", locale: "ru" }),
    );
    expect(invoiceHtml).toContain("INV-1");
    expect(invoiceHtml).toContain("Labour");
  });
});
