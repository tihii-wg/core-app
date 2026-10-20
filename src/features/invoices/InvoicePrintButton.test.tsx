import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Invoice, InvoiceDocument } from "../../lib/types";

const getInvoiceMock = vi.fn();
vi.mock("../../services/apiInvoices", () => ({
  getInvoice: (...args: unknown[]) => getInvoiceMock(...args),
}));
vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ currency: "MDL", formatMoney: (value: number) => `${value.toFixed(2)} MDL` }),
}));
vi.mock("./useInvoiceDocumentData", () => ({
  useInvoiceDocumentData: () => ({
    isLoading: false,
    companyName: "Auto Service",
    logoUrl: null,
    supplier: { name: "Auto Service SRL", address: "", registrationNumber: "", taxNumber: "", email: "", iban: "", bankName: "", bankCode: "", extraInfo: "" },
    sections: { works: [], materials: [], worksSubtotal: 0, materialsSubtotal: 0, grandTotal: 0 },
  }),
}));
vi.mock("./InvoicePrintRoot", () => ({
  InvoicePrintRoot: ({ job }: { job: { invoice: { id: string; invoiceNumber: string } } }) => (
    <div data-testid="print-root">{job.invoice.invoiceNumber}</div>
  ),
}));

import { InvoicePrintButton } from "./InvoicePrintButton";

const invoice: Invoice = {
  id: "inv-42",
  workspaceId: "ws-1",
  invoiceNumber: "INV-2026-042",
  clientId: "client-1",
  clientName: "Ada",
  device: "",
  carNumber: "",
  vin: "",
  description: "",
  subtotal: 10,
  amount: 10,
  total: 10,
  status: "sent",
  dueDate: "2026-10-18",
  createdAt: "2026-10-04",
  updatedAt: "2026-10-04",
};

const document: InvoiceDocument = { ...invoice, items: [] };

function renderButton(onRowClick = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onRowClick,
    ...render(
      <QueryClientProvider client={client}>
        <div onClick={onRowClick}>
          <InvoicePrintButton invoice={invoice} />
        </div>
      </QueryClientProvider>,
    ),
  };
}

describe("InvoicePrintButton", () => {
  it("loads the clicked invoice and opens the print workflow without row navigation", async () => {
    const user = userEvent.setup();
    let resolveDocument: (value: InvoiceDocument) => void = () => {};
    getInvoiceMock.mockReturnValue(new Promise<InvoiceDocument>((resolve) => { resolveDocument = resolve; }));
    const { onRowClick } = renderButton();

    const button = screen.getByRole("button", { name: "Print" });
    await user.click(button);

    // Loading state: repeated clicks are blocked while data loads.
    expect(button).toBeDisabled();
    expect(getInvoiceMock).toHaveBeenCalledTimes(1);
    expect(getInvoiceMock).toHaveBeenCalledWith("inv-42", "ws-1");
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.queryByTestId("print-root")).not.toBeInTheDocument();

    resolveDocument(document);
    await waitFor(() => expect(screen.getByTestId("print-root")).toHaveTextContent("INV-2026-042"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
