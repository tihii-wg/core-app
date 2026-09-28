import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
});
