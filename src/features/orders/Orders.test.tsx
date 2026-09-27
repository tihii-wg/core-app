import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Orders } from "./Orders";
import type { Order } from "../../lib/types";

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  orderNumber: "ORD-2026-003",
  device: "BMW",
  vin: "",
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
    render(<Orders />);

    expect(screen.getByText("ORD-2026-003")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("BMW")).toBeInTheDocument();
    expect(screen.getByText("Oil change")).toBeInTheDocument();
    expect(screen.getByText("1 total orders")).toBeInTheDocument();
  });
});
