import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoiceFromOrder } from "../../services/apiInvoices";
import { fake } from "../fakeSupabase";
import { USERS, WS, row, seedCoreApp } from "../coreAppDb";
import { installDomStubs, renderApp, trackUnhandledRejections } from "../appHarness";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

const year = new Date().getFullYear();
const orderNumber = `ORD-${year}-001`;
const invoiceNumber = `INV-${year}-001`;
let unhandled: ReturnType<typeof trackUnhandledRejections>;

beforeEach(() => {
  seedCoreApp();
  installDomStubs();
  unhandled = trackUnhandledRejections();
});

afterEach(() => unhandled.stop());

async function seedInvoice(workspaceId: string = WS.A, orderId = "order-a1") {
  fake.signInAs(USERS.owner.id);
  return createInvoiceFromOrder(orderId, workspaceId);
}

function openInvoices(userId: string = USERS.member.id) {
  fake.signInAs(userId);
  return renderApp(`/en/${WS.A}/invoices`);
}

describe("invoices page", () => {
  it("lists only the active workspace's invoices from the database", async () => {
    await seedInvoice();
    await seedInvoice(WS.B, "order-b1");
    openInvoices();

    const table = await screen.findByRole("table");
    expect(await within(table).findByText(invoiceNumber)).toBeInTheDocument();
    expect(within(table).getByText("Ada Alpha")).toBeInTheDocument();
    expect(within(table).getByText(orderNumber)).toBeInTheDocument();
    expect(within(table).queryByText("Bob Beta")).not.toBeInTheDocument();
    expect(screen.getByText("1 total invoices")).toBeInTheDocument();
    expect(screen.queryByText(/sample invoices/i)).not.toBeInTheDocument();
  });

  it("creates an invoice from an order picked in the dialog, then stops offering that order", async () => {
    const { user } = openInvoices();
    expect(await screen.findByText("No invoices yet")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Create Invoice/ })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Create Invoice" })).toBeDisabled();
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: new RegExp(`${orderNumber} · Ada Alpha`) }));
    expect(within(dialog).getByText("Oil change")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create Invoice" }));

    expect(await screen.findByText(`Invoice ${invoiceNumber} created`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await within(screen.getByRole("table")).findByText(invoiceNumber)).toBeInTheDocument();
    expect(fake.all("invoices")).toEqual([expect.objectContaining({ workspace_id: WS.A, order_id: "order-a1", number: invoiceNumber, total: 40, status: "draft" })]);

    await user.click(screen.getByRole("button", { name: /Create Invoice/ }));
    expect(await within(await screen.findByRole("dialog")).findByText("Every order with services already has an invoice.")).toBeInTheDocument();
  });

  it("keeps the dialog open and reports the error when creation is rejected", async () => {
    const { user } = openInvoices();
    await screen.findByText("No invoices yet");
    fake.failNext("invoices", "insert", { code: "42501", message: 'new row violates row-level security policy for table "invoices"' });

    await user.click(screen.getAllByRole("button", { name: /Create Invoice/ })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: new RegExp(orderNumber) }));
    await user.click(within(dialog).getByRole("button", { name: "Create Invoice" }));

    expect(await screen.findByText('new row violates row-level security policy for table "invoices"')).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fake.all("invoices")).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled.rejections).toEqual([]);
  });

  it("marks an invoice as sent, paid and unpaid from the row menu", async () => {
    const invoice = await seedInvoice();
    const { user } = openInvoices();
    const actions = await screen.findByRole("button", { name: `Actions for invoice ${invoiceNumber}` });

    await user.click(actions);
    await user.click(await screen.findByRole("menuitem", { name: "Mark as sent" }));
    expect(await screen.findByText(`Invoice ${invoiceNumber} marked as sent`)).toBeInTheDocument();
    expect(row("invoices", invoice.id)).toMatchObject({ status: "sent", paid_at: null });
    expect(await screen.findByText(/Unpaid/)).toBeInTheDocument();

    await user.click(actions);
    expect(screen.queryByRole("menuitem", { name: "Mark as sent" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("menuitem", { name: "Mark as paid" }));
    expect(await screen.findByText(`Invoice ${invoiceNumber} marked as paid`)).toBeInTheDocument();
    expect(row("invoices", invoice.id)?.paid_at).toEqual(expect.any(String));

    await user.click(actions);
    await user.click(await screen.findByRole("menuitem", { name: "Mark as unpaid" }));
    expect(await screen.findByText(`Invoice ${invoiceNumber} marked as sent`)).toBeInTheDocument();
    expect(row("invoices", invoice.id)).toMatchObject({ status: "sent", paid_at: null });
  });

  it("opens an invoice from its row with the billed services and marks it paid from the panel", async () => {
    const invoice = await seedInvoice();
    const { user } = openInvoices();

    await user.click(await within(await screen.findByRole("table")).findByText("Ada Alpha"));
    const panel = await screen.findByRole("dialog");

    expect(await within(panel).findByText("Oil change")).toBeInTheDocument();
    expect(within(panel).getByText(invoiceNumber)).toBeInTheDocument();
    expect(within(panel).getByText(orderNumber)).toBeInTheDocument();
    expect(within(panel).getByText("Alpha Garage car")).toBeInTheDocument();
    expect(within(panel).getByText("Draft")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Mark as paid" }));

    expect(await within(panel).findByText("Paid")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Mark as unpaid" })).toBeInTheDocument();
    expect(row("invoices", invoice.id)).toMatchObject({ status: "paid" });
  });

  it("explains that invoices are not set up when the database has no invoices table", async () => {
    fake.failNext("invoices", "select", { code: "PGRST205", message: "Could not find the table 'public.invoices' in the schema cache" });
    openInvoices();

    expect(await screen.findByText("Invoices are not set up yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Invoice/ })).toBeDisabled();
    expect(fake.requests.filter((request) => request.table === "invoices" && request.op === "insert")).toHaveLength(0);
  });
});
