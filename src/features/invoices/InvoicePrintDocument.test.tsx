import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InvoiceDocument } from "../../lib/types";
import { classifyInvoiceItems } from "./invoiceItemSections";
import { InvoicePrintDocument, type InvoiceSupplierInfo } from "./InvoicePrintDocument";

const formatMoney = (value: number) => `${value.toFixed(2)} MDL`;

const invoice: InvoiceDocument = {
  id: "inv-1",
  workspaceId: "ws-1",
  invoiceNumber: "INV-2026-001",
  clientId: "client-1",
  clientName: "Ada Alpha",
  clientPhone: "+37360000000",
  orderId: "order-1",
  orderNumber: "ORD-2026-001",
  device: "VW Golf",
  carNumber: "ABC123",
  vin: "",
  description: "",
  subtotal: 90,
  amount: 90,
  total: 90,
  status: "sent",
  dueDate: "2026-10-18",
  createdAt: "2026-10-04",
  updatedAt: "2026-10-04",
  items: [
    { id: "i1", invoiceId: "inv-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1, position: 0, createdAt: "2026-10-04" },
    { id: "i2", invoiceId: "inv-1", serviceId: null, serviceName: "Oil filter", price: 15, quantity: 2, position: 1, createdAt: "2026-10-04" },
    { id: "i3", invoiceId: "inv-1", serviceId: null, serviceName: "A very long material description that must wrap across multiple lines without breaking the table layout or the page", price: 10, quantity: 2, position: 2, createdAt: "2026-10-04" },
  ],
};

const supplier: InvoiceSupplierInfo = {
  name: "Auto Service SRL",
  address: "str. Columna 90, Chisinau",
  registrationNumber: "1002600000000",
  taxNumber: "1002600000000",
  email: "billing@example.com",
  iban: "MD24AG000225100013104168",
  bankName: "MAIB",
  bankCode: "AGRNMD2X",
  extraInfo: "Payment within 14 days.",
};

describe("InvoicePrintDocument", () => {
  it("renders works and materials in separate sections with subtotals and the amount due", () => {
    render(
      <InvoicePrintDocument
        invoice={invoice}
        sections={classifyInvoiceItems(invoice.items)}
        companyName="Auto Service"
        logoUrl="https://example.com/logo.png"
        supplier={supplier}
        formatMoney={formatMoney}
      />,
    );

    expect(screen.getByText("Works / Services")).toBeInTheDocument();
    expect(screen.getByText("Materials / Parts")).toBeInTheDocument();
    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.getByText("Oil filter")).toBeInTheDocument();
    expect(screen.getByText("Works subtotal")).toBeInTheDocument();
    expect(screen.getByText("Materials subtotal")).toBeInTheDocument();
    expect(screen.getByText("Amount due")).toBeInTheDocument();
    // works 40 + materials (15*2 + 10*2) = 90
    expect(screen.getAllByText("90.00 MDL").length).toBeGreaterThan(0);
    expect(screen.getByText("MD24AG000225100013104168")).toBeInTheDocument();
    expect(screen.getByText(/not a fiscal invoice/i)).toBeInTheDocument();
  });

  it("renders every item of a long invoice (nothing clipped or omitted)", () => {
    const manyItems = Array.from({ length: 30 }, (_, index) => ({
      id: `m${index}`,
      invoiceId: "inv-1",
      serviceId: index < 15 ? `svc-${index}` : null,
      serviceName: index < 15 ? `Work item ${index + 1}` : `Material item ${index - 14}`,
      price: 10,
      quantity: 1,
      position: index,
      createdAt: "2026-10-04",
    }));
    const longInvoice = { ...invoice, items: manyItems };
    render(
      <InvoicePrintDocument
        invoice={longInvoice}
        sections={classifyInvoiceItems(manyItems)}
        companyName="Auto Service"
        logoUrl={null}
        supplier={supplier}
        formatMoney={formatMoney}
      />,
    );

    for (let index = 1; index <= 15; index += 1) {
      expect(screen.getByText(`Work item ${index}`)).toBeInTheDocument();
      expect(screen.getByText(`Material item ${index}`)).toBeInTheDocument();
    }
    // 30 items x 10.00 = 300.00 total due
    expect(screen.getAllByText("300.00 MDL").length).toBeGreaterThan(0);
  });

  it("renders without a logo and without optional supplier details", () => {
    render(
      <InvoicePrintDocument
        invoice={{ ...invoice, items: [invoice.items[0]], clientPhone: undefined }}
        sections={classifyInvoiceItems([invoice.items[0]])}
        companyName="Auto Service"
        logoUrl={null}
        supplier={{ name: "", address: "", registrationNumber: "", taxNumber: "", email: "", iban: "", bankName: "", bankCode: "", extraInfo: "" }}
        formatMoney={formatMoney}
      />,
    );

    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.queryByText("Materials / Parts")).not.toBeInTheDocument();
    expect(screen.queryByText("Payment details")).not.toBeInTheDocument();
  });
});
