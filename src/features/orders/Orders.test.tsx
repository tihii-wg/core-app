import { screen, within } from "@testing-library/react";
import { stubLocalStorage } from "../../tests/memoryStorage";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice, Order } from "../../lib/types";
import { ORDER_COLUMN_STORAGE_KEY } from "./orderColumnVisibility";
import { Orders } from "./Orders";

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  clientPhone: "+37361111111",
  orderNumber: "ORD-2026-003",
  device: "BMW",
  vin: "1HGBH41JXMN109186",
  carNumber: "ABC123",
  service: "Oil change",
  services: [],
  description: "Noise",
  status: "new",
  assignedEmployeeId: "emp-1",
  assignedEmployeeName: "Ada Tech",
  deadline: "2026-10-01",
  totalPrice: 40,
  isPaid: false,
  paymentStatus: "unpaid",
  createdById: "user-1",
  createdByName: "Olga Owner",
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26",
};

const statusHooks = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

const workspaceState = vi.hoisted(() => ({
  requireTaxInvoiceNumber: false,
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: { currency: "MDL", requireTaxInvoiceNumber: workspaceState.requireTaxInvoiceNumber },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetched: true,
  }),
}));

const ordersState = vi.hoisted(() => ({
  list: [] as Order[],
  total: 0,
  page: 1,
  pageSize: 25,
  pageCount: 1,
}));

const awaitingPaymentState = vi.hoisted(() => ({
  amount: 40,
  count: 1,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("./useGetOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useGetOrders")>();
  return {
    ...actual,
    useOrdersPage: () => ({
      orders: ordersState.list,
      total: ordersState.total,
      page: ordersState.page,
      pageSize: ordersState.pageSize,
      pageCount: ordersState.pageCount,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }),
    useOrdersAwaitingPayment: () => ({
      amount: awaitingPaymentState.amount,
      count: awaitingPaymentState.count,
      isLoading: awaitingPaymentState.isLoading,
      error: awaitingPaymentState.error,
      refetch: vi.fn(),
    }),
    useUpdateOrderStatus: () => ({ mutate: statusHooks.mutate, isPending: statusHooks.isPending }),
    useUpdateOrderTaxInvoiceNumber: () => ({ mutateAsync: vi.fn(async () => "FV-1"), isPending: false }),
  };
});

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({
    employees: [{ id: "emp-1", name: "Ada Tech", role: "technician", status: "active", profile_id: "user-1" }],
    isLoading: false,
  }),
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

vi.mock("./AddNewOrderForm", () => ({
  default: () => null,
}));

const invoiceHooks = vi.hoisted(() => ({
  invoices: [] as Invoice[],
  isUnavailable: false,
  isPending: false,
  mutate: vi.fn(),
}));

vi.mock("../invoices/useGetInvoices", () => ({
  useGetInvoices: () => ({ invoices: invoiceHooks.invoices, isLoading: false, error: null, isUnavailable: invoiceHooks.isUnavailable }),
}));

vi.mock("../invoices/useCreateInvoice", () => ({
  useCreateInvoice: () => ({ mutate: invoiceHooks.mutate, isPending: invoiceHooks.isPending }),
}));

beforeEach(() => {
  stubLocalStorage();
  invoiceHooks.invoices = [];
  invoiceHooks.isUnavailable = false;
  invoiceHooks.isPending = false;
  invoiceHooks.mutate.mockReset();
  statusHooks.isPending = false;
  statusHooks.mutate.mockReset();
  order.createdById = "user-1";
  order.createdByName = "Olga Owner";
  order.clientPhone = "+37361111111";
  ordersState.list = [order];
  ordersState.total = 1;
  ordersState.page = 1;
  ordersState.pageSize = 25;
  ordersState.pageCount = 1;
  awaitingPaymentState.amount = 40;
  awaitingPaymentState.count = 1;
  awaitingPaymentState.isLoading = false;
  awaitingPaymentState.error = null;
});

function manyOrders(count: number): Order[] {
  return Array.from({ length: count }, (_, index) => ({
    ...order,
    id: `order-${index + 1}`,
    orderNumber: `ORD-2026-${String(index + 1).padStart(3, "0")}`,
    clientName: `Client ${index + 1}`,
    device: `Device ${index + 1}`,
  }));
}

async function openActions() {
  const user = userEvent.setup();
  renderWithQuery(<Orders />);
  await user.click(screen.getByRole("button", { name: "Actions for order ORD-2026-003" }));
  return user;
}

describe("Orders page", () => {
  it("shows orders loaded from the workspace", () => {
    renderWithQuery(<Orders />);

    expect(screen.getByText("ORD-2026-003")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("BMW")).toBeInTheDocument();
    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.getByText("1 total orders")).toBeInTheDocument();
  });

  it("shows an Awaiting Payment card next to the Orders heading", () => {
    renderWithQuery(<Orders />);

    expect(screen.getByText("Awaiting Payment")).toBeInTheDocument();
    expect(screen.getByText("1 unpaid order")).toBeInTheDocument();
  });

  it("shows the server pagination summary, page controls, and page-size choices", () => {
    ordersState.list = manyOrders(25);
    ordersState.total = 55;
    ordersState.page = 1;
    ordersState.pageSize = 25;
    ordersState.pageCount = 3;
    renderWithQuery(<Orders />);

    expect(screen.getByText(/Showing 1–25 of 55 orders/)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Orders per page" })).toBeInTheDocument();
  });

  it("lets the user hide and show order fields from the Columns menu", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Orders />);

    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Created by" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Client" }));
    expect(screen.queryByRole("columnheader", { name: "Client" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Order #" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(ORDER_COLUMN_STORAGE_KEY) ?? "[]")).not.toContain("client");

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Client" }));
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
  });

  it("restores the saved column selection on load", () => {
    window.localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify(["status", "total"]));
    renderWithQuery(<Orders />);

    expect(screen.getByRole("columnheader", { name: "Order #" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Client" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Created by" })).not.toBeInTheDocument();
  });

  it("shows the client name with the phone number underneath", () => {
    renderWithQuery(<Orders />);

    const clientCell = screen.getByText("Ada Lovelace").parentElement?.parentElement;
    expect(clientCell).toHaveTextContent("Ada Lovelace");
    expect(clientCell).toHaveTextContent("+37361111111");
  });

  it("shows a dash when the client phone is missing", () => {
    order.clientPhone = "";
    renderWithQuery(<Orders />);

    const clientCell = screen.getByText("Ada Lovelace").parentElement?.parentElement;
    expect(clientCell).toHaveTextContent("Ada Lovelace");
    expect(clientCell).toHaveTextContent("—");
  });

  it("shows the creator name with the creation date underneath", () => {
    renderWithQuery(<Orders />);

    expect(screen.getByRole("columnheader", { name: "Created by" })).toBeInTheDocument();
    const creatorCell = screen.getByText("Olga Owner").parentElement?.parentElement;
    expect(creatorCell).toHaveTextContent("Olga Owner");
    expect(creatorCell).toHaveTextContent("2026-09-26");
  });

  it("shows Unknown when the creator name is missing", () => {
    order.createdByName = "";
    order.createdById = undefined;
    renderWithQuery(<Orders />);

    const creatorCell = screen.getByText("Unknown").parentElement?.parentElement;
    expect(creatorCell).toHaveTextContent("Unknown");
    expect(creatorCell).toHaveTextContent("2026-09-26");
  });

  it("keeps the search field available for server-side order lookup", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Orders />);

    const search = screen.getByPlaceholderText("Search orders...");
    await user.type(search, "1hgb");
    expect(search).toHaveValue("1hgb");
    expect(screen.getByText("ORD-2026-003")).toBeInTheDocument();
  });

  it("shows a three-dot actions menu with view, status, edit, and invoice actions", async () => {
    await openActions();

    expect(screen.queryByRole("button", { name: /Edit order/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "View details" })).toBeInTheDocument();
    expect(screen.getByText("Change status")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Create Invoice" })).toBeInTheDocument();
  });

  it("opens the order details panel from the actions menu", async () => {
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "View details" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: /ORD-2026-003/ })).toBeInTheDocument();
  });

  it("changes order status from the list actions menu", async () => {
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "In Progress" }));

    expect(statusHooks.mutate).toHaveBeenCalledExactlyOnceWith(
      { orderId: "order-1", status: "in-progress" },
      expect.any(Object),
    );
  });

  it("disables status changes while a status update is pending", async () => {
    statusHooks.isPending = true;
    const user = await openActions();

    expect(screen.getByText("Updating status...")).toBeInTheDocument();
    const inProgress = screen.getByRole("menuitem", { name: "In Progress" });
    expect(inProgress).toHaveAttribute("aria-disabled", "true");
    await user.click(inProgress);
    expect(statusHooks.mutate).not.toHaveBeenCalled();
  });

  it("creates an invoice for the order from the menu and closes the menu", async () => {
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "Create Invoice" }));

    expect(invoiceHooks.mutate).toHaveBeenCalledExactlyOnceWith("order-1");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("selects the actions with the keyboard", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Orders />);
    screen.getByRole("button", { name: "Actions for order ORD-2026-003" }).focus();

    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "View details" })).toHaveFocus();
    await user.keyboard("{End}{Enter}");

    expect(invoiceHooks.mutate).toHaveBeenCalledExactlyOnceWith("order-1");
  });

  it("closes the menu on Escape and on a click outside without doing anything", async () => {
    const user = await openActions();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for order ORD-2026-003" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByText("1 total orders"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(invoiceHooks.mutate).not.toHaveBeenCalled();
  });

  it("shows the existing invoice instead of offering another one", async () => {
    invoiceHooks.invoices = [{ id: "inv-1", workspaceId: "ws-1", invoiceNumber: "INV-2026-001", clientId: "client-1", clientName: "Ada Lovelace", orderId: "order-1", orderNumber: "ORD-2026-003", device: "", carNumber: "", vin: "", description: "", subtotal: 40, amount: 40, total: 40, status: "draft", dueDate: "", createdAt: "2026-10-04", updatedAt: "2026-10-04" }];
    const user = await openActions();

    const invoiced = screen.getByRole("menuitem", { name: "Invoice INV-2026-001 already created" });
    expect(invoiced).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: "Create Invoice" })).not.toBeInTheDocument();
    await user.click(invoiced);
    expect(invoiceHooks.mutate).not.toHaveBeenCalled();
  });

  it("disables Create Invoice while an invoice is being created", async () => {
    invoiceHooks.isPending = true;
    const user = await openActions();

    const creating = screen.getByRole("menuitem", { name: "Creating invoice..." });
    expect(creating).toHaveAttribute("aria-disabled", "true");
    await user.click(creating);
    expect(invoiceHooks.mutate).not.toHaveBeenCalled();
  });

  it("explains that invoices are unavailable when the database has no invoices tables", async () => {
    invoiceHooks.isUnavailable = true;
    await openActions();

    expect(screen.getByRole("menuitem", { name: "Invoices are not set up yet" })).toHaveAttribute("aria-disabled", "true");
  });

  it("blocks marking a legal-entity order paid without a tax invoice number when the workspace requires one", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    order.clientType = "organization";
    order.taxInvoiceNumber = "";
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "Paid" }));

    expect(statusHooks.mutate).not.toHaveBeenCalled();
    // The order opens so the number can be entered without losing context.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    workspaceState.requireTaxInvoiceNumber = false;
    order.clientType = undefined;
  });

  it("blocks marking a legal-entity order paid when the tax invoice number is whitespace-only", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    order.clientType = "organization";
    order.taxInvoiceNumber = "   ";
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "Paid" }));

    expect(statusHooks.mutate).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    workspaceState.requireTaxInvoiceNumber = false;
    order.taxInvoiceNumber = "";
    order.clientType = undefined;
  });

  it("allows marking a legal-entity order paid once a tax invoice number is saved", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    order.clientType = "organization";
    order.taxInvoiceNumber = "FV-2026-77";
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "Paid" }));

    expect(statusHooks.mutate).toHaveBeenCalledExactlyOnceWith(
      { orderId: "order-1", status: "paid" },
      expect.any(Object),
    );
    workspaceState.requireTaxInvoiceNumber = false;
    order.taxInvoiceNumber = "";
    order.clientType = undefined;
  });

  it("allows marking an individual order paid without a tax invoice number when the setting is enabled", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    order.clientType = "individual";
    order.taxInvoiceNumber = "";
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "Paid" }));

    expect(statusHooks.mutate).toHaveBeenCalledExactlyOnceWith(
      { orderId: "order-1", status: "paid" },
      expect.any(Object),
    );
    expect(screen.queryByLabelText("Tax invoice number")).not.toBeInTheDocument();
    workspaceState.requireTaxInvoiceNumber = false;
    order.clientType = undefined;
  });

  it("shows the tax invoice field only for legal-entity orders", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    order.clientType = "organization";
    order.taxInvoiceNumber = "FV-2026-77";
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "View details" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Tax invoice number")).toHaveValue("FV-2026-77");
    expect(screen.getByLabelText("Tax invoice number")).not.toHaveAttribute("aria-invalid");
    workspaceState.requireTaxInvoiceNumber = false;
    order.taxInvoiceNumber = "";
    order.clientType = undefined;
  });

  it("keeps a saved tax invoice number visible without validation errors on a paid legal-entity order", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    order.clientType = "organization";
    order.taxInvoiceNumber = "FV-PAID-1";
    order.status = "paid";
    order.isPaid = true;
    order.paymentStatus = "paid";
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "View details" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Tax invoice number")).toHaveValue("FV-PAID-1");
    expect(screen.getByLabelText("Tax invoice number")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/tax invoice number is required/i)).not.toBeInTheDocument();

    workspaceState.requireTaxInvoiceNumber = false;
    order.taxInvoiceNumber = "";
    order.clientType = undefined;
    order.status = "new";
    order.isPaid = false;
    order.paymentStatus = "unpaid";
  });

  it("does not show the tax invoice field for individual orders", async () => {
    workspaceState.requireTaxInvoiceNumber = true;
    order.clientType = "individual";
    order.taxInvoiceNumber = "FV-should-not-display-as-required";
    const user = await openActions();

    await user.click(screen.getByRole("menuitem", { name: "View details" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tax invoice number")).not.toBeInTheDocument();
    workspaceState.requireTaxInvoiceNumber = false;
    order.taxInvoiceNumber = "";
    order.clientType = undefined;
  });
});
