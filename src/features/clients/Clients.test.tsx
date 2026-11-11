import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorage } from "../../tests/memoryStorage";
import { renderWithQuery } from "../../tests/renderQuery";
import { CLIENT_COLUMN_STORAGE_KEY } from "./clientColumnVisibility";
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
  useUpdateOrderStatus: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useUpdateOrderTaxInvoiceNumber: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock("../../hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

describe("Clients order counts", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("shows how many saved orders belong to each client", () => {
    renderWithQuery(<Clients />);

    const adaRow = screen.getByRole("row", { name: /Ada Lovelace/ });
    const graceRow = screen.getByRole("row", { name: /Grace Hopper/ });

    expect(within(adaRow).getAllByRole("cell")[3]).toHaveTextContent("2");
    expect(within(graceRow).getAllByRole("cell")[3]).toHaveTextContent("0");
  });

  it("lets the user hide and show client fields from the Columns menu", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Clients />);

    expect(screen.getByRole("columnheader", { name: "Contact" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Balance" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Contact" }));
    expect(screen.queryByRole("columnheader", { name: "Contact" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(CLIENT_COLUMN_STORAGE_KEY) ?? "[]")).not.toContain("contact");

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Contact" }));
    expect(screen.getByRole("columnheader", { name: "Contact" })).toBeInTheDocument();
  });

  it("restores the saved column selection on load", () => {
    window.localStorage.setItem(CLIENT_COLUMN_STORAGE_KEY, JSON.stringify(["orders", "balance"]));
    renderWithQuery(<Clients />);

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Balance" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Client Type" })).not.toBeInTheDocument();
  });

  it("keeps the search field available after column preferences change", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Clients />);

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Balance" }));

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
  });
});
