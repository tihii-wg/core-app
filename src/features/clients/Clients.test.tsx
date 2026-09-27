import { render, screen, within } from "@testing-library/react";
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
    orders: [
      { id: "order-1", clientId: "client-1", orderNumber: "ORD-2026-001", device: "BMW", service: "Oil change", totalPrice: 40 },
      { id: "order-2", clientId: "client-1", orderNumber: "ORD-2026-002", device: "BMW", service: "Tires", totalPrice: 80 },
      { id: "order-3", clientId: "client-9", orderNumber: "ORD-2026-003", device: "Audi", service: "Oil change", totalPrice: 40 },
    ],
  }),
}));

describe("Clients order counts", () => {
  it("shows how many saved orders belong to each client", () => {
    render(<Clients />);

    const adaRow = screen.getByRole("row", { name: /Ada Lovelace/ });
    const graceRow = screen.getByRole("row", { name: /Grace Hopper/ });

    expect(within(adaRow).getAllByRole("cell")[2]).toHaveTextContent("2");
    expect(within(graceRow).getAllByRole("cell")[2]).toHaveTextContent("0");
  });
});
