import { screen } from "@testing-library/react";
import { stubLocalStorage } from "../../tests/memoryStorage";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { Orders } from "./Orders";

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  clientPhone: "+37361111111",
  orderNumber: "ORD-2026-003",
  device: "BMW X5",
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

const ordersState = vi.hoisted(() => ({ list: [] as Order[], total: 0, page: 1, pageSize: 25, pageCount: 1 }));

vi.mock("./useGetOrders", () => ({
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
  useOrdersAwaitingPayment: () => ({ amount: 40, count: 1, isLoading: false, error: null, refetch: vi.fn() }),
  useUpdateOrderStatus: () => ({ mutate: vi.fn(), isPending: false }),
}));

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

vi.mock("./AddNewOrderForm", () => ({ default: () => null }));

vi.mock("../invoices/useGetInvoices", () => ({
  useGetInvoices: () => ({ invoices: [], isLoading: false, error: null, isUnavailable: false }),
}));

vi.mock("../invoices/useCreateInvoice", () => ({
  useCreateInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

function stubMobileViewport() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
}

beforeEach(() => {
  stubLocalStorage();
  ordersState.list = [order];
  ordersState.total = 1;
  ordersState.page = 1;
  ordersState.pageCount = 1;
});

describe("Orders page on a phone viewport", () => {
  it("renders order cards instead of the table", async () => {
    stubMobileViewport();
    renderWithQuery(<Orders />);

    expect(await screen.findByText("ORD-2026-003")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("BMW X5")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });

  it("opens the order detail from a card tap, but not from the actions button", async () => {
    stubMobileViewport();
    const user = userEvent.setup();
    renderWithQuery(<Orders />);

    await user.click(await screen.findByRole("button", { name: "Actions for order ORD-2026-003" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "View details" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("Orders page on a desktop viewport", () => {
  it("keeps the table layout", () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    renderWithQuery(<Orders />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
  });
});
