import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "../../lib/types";

const printInvoiceDocument = vi.fn();
vi.mock("../../services/apiInvoices", () => ({
  getInvoice: vi.fn(),
}));
vi.mock("../../services/apiDocumentTemplates", () => ({
  printInvoiceDocument: (...args: unknown[]) => printInvoiceDocument(...args),
}));
vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ currency: "MDL", formatMoney: (value: number) => `${value.toFixed(2)} MDL` }),
}));
vi.mock("../documents/useGetDocumentTemplates", () => ({
  useGetDocumentTemplates: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
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
  beforeEach(() => {
    printInvoiceDocument.mockReset();
    printInvoiceDocument.mockResolvedValue("printed");
  });

  it("prints the built-in invoice when the workspace has no custom templates", async () => {
    const user = userEvent.setup();
    const { onRowClick } = renderButton();

    const button = screen.getByRole("button", { name: "Print" });
    await user.click(button);

    await waitFor(() => {
      expect(printInvoiceDocument).toHaveBeenCalledWith("inv-42", "builtin:invoice", "ws-1");
    });
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
