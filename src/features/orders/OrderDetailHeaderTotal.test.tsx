import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Order } from "../../lib/types";
import { OrderDetailHeaderTotal } from "./OrderDetailHeaderTotal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === "orders.vat.net") return "Net";
      if (key === "orders.vat.vat") return `VAT ${opts?.rate}%`;
      if (key === "orders.detail.discount") return "Discount";
      return key;
    },
  }),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ locale: "en", workspaceId: "ws-1" }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("./OrderTotalBreakdownPopover", () => ({
  OrderTotalBreakdownPopover: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="breakdown-trigger">{children}</span>
  ),
}));

function order(partial: Partial<Order> = {}): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [{ id: "s1", serviceId: "svc", serviceName: "Oil", price: 100, quantity: 1 }],
    materials: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 120,
    vatRate: 20,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "",
    updatedAt: "",
    ...partial,
  } as Order;
}

describe("OrderDetailHeaderTotal", () => {
  it("renders the total, compact VAT, and payment badge", () => {
    render(
      <OrderDetailHeaderTotal
        order={order()}
        formatMoney={(n) => `MDL ${n.toFixed(2)}`}
        paymentStatus="unpaid"
        workspaceVatRate={20}
        worksLabel="Works"
        materialsLabel="Materials"
      />,
    );
    const header = screen.getByTestId("order-detail-header-total");
    // Phone: total + badge in one row; sm+: stacked and right-aligned before the sheet icons.
    expect(header.className).toMatch(/justify-between/);
    expect(header.className).toMatch(/sm:flex-col/);
    expect(header.className).toMatch(/sm:items-end/);
    expect(screen.getByTestId("breakdown-trigger")).toHaveTextContent("MDL 120.00");
    expect(screen.getByTestId("order-header-vat")).toBeInTheDocument();
    expect(screen.getByTestId("order-header-vat-net")).toHaveTextContent("MDL 100.00");
  });

  it("shows MDL 0.00 for a zero total and hides VAT when there is no rate", () => {
    render(
      <OrderDetailHeaderTotal
        order={order({ totalPrice: 0, vatRate: null, services: [] })}
        formatMoney={(n) => `MDL ${n.toFixed(2)}`}
        paymentStatus="unpaid"
        workspaceVatRate={null}
        worksLabel="Works"
        materialsLabel="Materials"
      />,
    );
    expect(screen.getByTestId("breakdown-trigger")).toHaveTextContent("MDL 0.00");
    expect(screen.queryByTestId("order-header-vat")).not.toBeInTheDocument();
  });
});
