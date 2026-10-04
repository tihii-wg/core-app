import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "../../lib/types";
import { Orders } from "./Orders";
import type { Order } from "../../lib/types";

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
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
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26",
};

vi.mock("./useGetOrders", () => ({
  useGetOrders: () => ({ orders: [order], isLoading: false }),
  useUpdateOrderStatus: () => ({ mutate: vi.fn() }),
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees: [{ id: "emp-1", name: "Ada Tech" }], isLoading: false }),
}));

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
  invoiceHooks.invoices = [];
  invoiceHooks.isUnavailable = false;
  invoiceHooks.isPending = false;
  invoiceHooks.mutate.mockReset();
});

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

  it("finds an order by VIN the same way it finds one by client name", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Orders />);

    await user.type(screen.getByPlaceholderText("Search orders..."), "1hgb");
    expect(screen.getByText("ORD-2026-003")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search orders..."));
    await user.type(screen.getByPlaceholderText("Search orders..."), "ada lovelace");
    expect(screen.getByText("ORD-2026-003")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search orders..."));
    await user.type(screen.getByPlaceholderText("Search orders..."), "not-a-vin");
    expect(screen.queryByText("ORD-2026-003")).not.toBeInTheDocument();
  });

  it("shows a three-dot actions menu with Edit and Create Invoice in place of the pencil button", async () => {
    await openActions();

    expect(screen.queryByRole("button", { name: /Edit order/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Edit", "Create Invoice"]);
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
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");

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
    invoiceHooks.invoices = [{ id: "inv-1", invoiceNumber: "INV-2026-001", clientId: "client-1", clientName: "Ada Lovelace", orderId: "order-1", orderNumber: "ORD-2026-003", amount: 40, status: "draft", dueDate: "", createdAt: "2026-10-04" }];
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
});
