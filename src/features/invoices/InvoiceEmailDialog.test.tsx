import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceDocument } from "../../lib/types";
import { InvoiceEmailDialog } from "./InvoiceEmailDialog";

const invoice: InvoiceDocument = {
  id: "inv-1",
  workspaceId: "ws-1",
  invoiceNumber: "INV-2026-0000001",
  clientId: "client-1",
  clientName: "A very long customer name that should wrap inside the dialog instead of pushing it wider",
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
  items: [],
};

describe("InvoiceEmailDialog layout guards", () => {
  it("keeps every control inside a constrained, wrapping dialog structure", async () => {
    const user = userEvent.setup();
    render(<InvoiceEmailDialog invoice={invoice} onClose={vi.fn()} onDownloadPdf={vi.fn()} />);

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).not.toBeNull();
    // Mobile-safe width, desktop cap, internal scrolling, single shrinkable column.
    expect(content?.className).toContain("max-w-[calc(100vw-2rem)]");
    expect(content?.className).toContain("sm:max-w-lg");
    expect(content?.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(content?.className).toContain("overflow-y-auto");
    expect(content?.className).toContain("[grid-template-columns:minmax(0,1fr)]");

    const input = screen.getByLabelText(/recipient email/i);
    expect(input.className).toContain("min-w-0");

    const footer = document.querySelector('[data-slot="dialog-footer"]');
    expect(footer?.className).toContain("flex-wrap");
    for (const button of footer?.querySelectorAll("button") ?? []) {
      expect(button.className).toContain("min-w-0");
      expect(button.className).toContain("whitespace-normal");
    }

    // Workflow preserved: typing a valid email enables the mail-app action.
    const openButton = screen.getByRole("button", { name: /open mail app/i });
    expect(openButton).toBeDisabled();
    await user.type(input, "a.very.long.email.address.for.testing@subdomain.example-company.com");
    expect(openButton).toBeEnabled();
  });
});
