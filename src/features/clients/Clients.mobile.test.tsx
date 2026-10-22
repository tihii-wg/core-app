import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
        balance: 120,
        created_at: "2024-07-01T10:00:00.000Z",
        client_type: "individual",
      },
    ],
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../orders/useGetOrders", () => ({
  useGetOrders: () => ({
    isLoading: false,
    error: null,
    orders: [
      { id: "order-1", clientId: "client-1", orderNumber: "ORD-2026-001", device: "BMW", vin: "", carNumber: "", service: "Oil change", totalPrice: 40, status: "completed", isPaid: true, createdAt: "2026-09-01" },
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

describe("Clients page viewports", () => {
  beforeEach(() => {
    stubViewport(1280);
  });

  it("renders client cards instead of the table on a phone", async () => {
    stubViewport(375);
    renderWithQuery(<Clients />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("+37361111111")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for client Ada Lovelace" })).toBeInTheDocument();
  });

  it("opens the client detail panel from a card tap, not from the menu", async () => {
    stubViewport(375);
    const user = userEvent.setup();
    renderWithQuery(<Clients />);

    await user.click(await screen.findByRole("button", { name: "Actions for client Ada Lovelace" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByText("Ada Lovelace"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the table on desktop", () => {
    renderWithQuery(<Clients />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Ada Lovelace/ })).toBeInTheDocument();
  });
});
