import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "../../lib/types";
import { Invoices } from "./Invoices";

const detailState = vi.hoisted(() => ({ invoiceId: null as string | null }));
const statusState = vi.hoisted(() => ({ mutate: vi.fn() }));

const invoice: Invoice = {
  id: "inv-1",
  workspaceId: "ws-1",
  invoiceNumber: "INV-2026-001",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  clientPhone: "+37361111111",
  orderId: "order-1",
  orderNumber: "ORD-2026-003",
  device: "BMW X5",
  carNumber: "ABC123",
  vin: "",
  description: "",
  subtotal: 100,
  amount: 100,
  total: 100,
  status: "sent",
  dueDate: "",
  createdAt: "2026-10-04",
  updatedAt: "2026-10-04",
};

vi.mock("./useGetInvoices", () => ({
  useGetInvoices: () => ({ invoices: [invoice], isLoading: false, error: null, refetch: vi.fn(), isUnavailable: false }),
}));

vi.mock("../orders/useGetOrders", () => ({
  useGetOrders: () => ({ orders: [], isLoading: false, error: null }),
}));

vi.mock("./useUpdateInvoiceStatus", () => ({
  useUpdateInvoiceStatus: () => ({ mutate: statusState.mutate, isPending: false }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: "auto_repair", industryId: null, isLoading: false, error: null };
    },
  };
});

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ currency: "MDL", formatMoney: (v: number) => `MDL ${v.toFixed(2)}` }),
}));

vi.mock("./CreateInvoiceDialog", () => ({ CreateInvoiceDialog: () => null }));

vi.mock("./InvoiceDetailPanel", () => ({
  InvoiceDetailPanel: ({ invoiceId }: { invoiceId: string | null }) => {
    detailState.invoiceId = invoiceId;
    return invoiceId ? <div data-testid="invoice-detail" /> : null;
  },
}));

function stubViewport(width: number) {
  window.matchMedia = ((query: string) => ({
    matches: width < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
}

beforeEach(() => {
  detailState.invoiceId = null;
  statusState.mutate.mockReset();
  stubViewport(1280);
});

describe("Invoices page viewports", () => {
  it("renders invoice cards instead of the table on a phone", async () => {
    stubViewport(390);
    renderWithQuery(<Invoices />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(await screen.findByText("INV-2026-001")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });

  it("opens details from a card tap, not from the actions menu", async () => {
    stubViewport(390);
    const user = userEvent.setup();
    renderWithQuery(<Invoices />);

    await user.click(await screen.findByRole("button", { name: "Actions for invoice INV-2026-001" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(detailState.invoiceId).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Mark as paid" }));
    expect(statusState.mutate).toHaveBeenCalledWith({ invoiceId: "inv-1", status: "paid" });
    expect(detailState.invoiceId).toBeNull();

    await user.click(screen.getByText("Ada Lovelace"));
    expect(detailState.invoiceId).toBe("inv-1");
  });

  it("keeps the table on desktop", () => {
    renderWithQuery(<Invoices />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /INV-2026-001/ })).toBeInTheDocument();
  });
});
