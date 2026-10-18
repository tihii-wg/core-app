import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import { describe, expect, it, vi } from "vitest";
import { Clients } from "./Clients";

vi.mock("./useGetClients", () => ({
  useGetClients: () => ({
    isLoading: false,
    isPending: false,
    clients: [
      {
        id: "client-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+37361111111",
        address: "",
        balance: 0,
        created_at: "2024-07-01T10:00:00.000Z",
      },
      {
        id: "client-2",
        name: "Grace Hopper",
        email: "grace@example.com",
        phone: "+37362222222",
        address: "",
        balance: 0,
        created_at: "2024-07-02T10:00:00.000Z",
      },
    ],
  }),
}));

vi.mock("../orders/useGetOrders", () => ({
  useGetOrders: () => ({
    isLoading: false,
    error: null,
    orders: [
      { id: "order-1", clientId: "client-1", orderNumber: "ORD-2026-001", device: "BMW", vin: "", carNumber: "", service: "Oil change", totalPrice: 40, status: "completed", createdAt: "2026-09-01" },
      { id: "order-2", clientId: "client-1", orderNumber: "ORD-2026-002", device: "BMW", vin: "", carNumber: "", service: "Tires", totalPrice: 80, status: "in-progress", createdAt: "2026-10-02" },
      { id: "order-3", clientId: "client-9", orderNumber: "ORD-2026-003", device: "Audi", vin: "", carNumber: "", service: "Oil change", totalPrice: 40, status: "new", createdAt: "2026-10-03" },
    ],
  }),
}));

vi.mock("../orders/useOrderDetails", () => ({
  useOrderDetails: () => ({
    openOrder: vi.fn(),
    syncOrder: vi.fn(),
    changeStatus: vi.fn(),
    isStatusUpdating: false,
    panelProps: {
      selectedOrder: null,
      detailPanelOpen: false,
      setDetailPanelOpen: vi.fn(),
      onOrderUpdated: vi.fn(),
      onStatusChange: vi.fn(),
      isStatusUpdating: false,
    },
  }),
}));

describe("Clients order counts", () => {
  it("shows how many saved orders belong to each client", () => {
    renderWithQuery(<Clients />);

    const adaRow = screen.getByRole("row", { name: /Ada Lovelace/ });
    const graceRow = screen.getByRole("row", { name: /Grace Hopper/ });

    expect(within(adaRow).getAllByRole("cell")[3]).toHaveTextContent("2");
    expect(within(graceRow).getAllByRole("cell")[3]).toHaveTextContent("0");
  });
});
