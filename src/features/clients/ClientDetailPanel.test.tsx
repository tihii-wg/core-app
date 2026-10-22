import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "../../lib/types";
import ClientDetailPanel from "./ClientDetailPanel";
import type { ClientOrderSummary } from "./clientOrders";

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("./useUpdateClient", () => ({
  useUpdateClient: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return {
        workflow,
        copy: industryOrderCopy(workflow),
        industrySlug: "auto_repair",
        industryId: null,
        isLoading: false,
        error: null,
      };
    },
  };
});

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

const client: Client = {
  id: "client-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+37361111111",
  address: "Chisinau",
  balance: 0,
  created_at: "2024-07-01T10:00:00.000Z",
  notes: "Prefers morning visits",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

const history: ClientOrderSummary[] = [
  {
    id: "order-2",
    orderNumber: "ORD-2026-002",
    device: "BMW",
    vin: "",
    carNumber: "ABC123",
    service: "Tires",
    totalPrice: 80,
    status: "in-progress",
    isPaid: false,
    createdAt: "2026-10-02",
  },
  {
    id: "order-1",
    orderNumber: "ORD-2026-001",
    device: "BMW",
    vin: "",
    carNumber: "",
    service: "Oil change",
    totalPrice: 40,
    isPaid: true,
    status: "completed",
    createdAt: "2026-09-01",
  },
];

function renderPanel({
  onClientUpdated = vi.fn(),
  setDetailPanelOpen = vi.fn(),
  getClientOrders = () => [] as ClientOrderSummary[],
  ordersLoading = false,
  ordersError = false,
  onOpenOrder,
  onCreateOrder,
  selectedClient = client,
}: {
  onClientUpdated?: (client: Client) => void;
  setDetailPanelOpen?: (open: boolean) => void;
  getClientOrders?: (clientId: string) => ClientOrderSummary[];
  ordersLoading?: boolean;
  ordersError?: boolean;
  onOpenOrder?: (orderId: string) => void;
  onCreateOrder?: (client: Client) => void;
  selectedClient?: Client;
} = {}) {
  renderWithQuery(
    <ClientDetailPanel
      selectedClient={selectedClient}
      detailPanelOpen
      setDetailPanelOpen={setDetailPanelOpen}
      onClientUpdated={onClientUpdated}
      getClientOrders={getClientOrders}
      ordersLoading={ordersLoading}
      ordersError={ordersError}
      onOpenOrder={onOpenOrder}
      onCreateOrder={onCreateOrder}
    />,
  );

  return { setDetailPanelOpen };
}

describe("ClientDetailPanel", () => {
  it("opens with a description and an edit button", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderPanel();

    expect(await screen.findByRole("heading", { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.getByText("View and edit this client's contact information, balance, and order history.")).toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton).toHaveTextContent("");
    expect(editButton.querySelector("svg")).toBeInTheDocument();

    const descriptionWarnings = warn.mock.calls.filter((args) => String(args[0]).includes("Description"));
    expect(descriptionWarnings).toHaveLength(0);

    warn.mockRestore();
  });

  it("saves client edits and shows the updated name", async () => {
    const user = userEvent.setup();
    const onClientUpdated = vi.fn();
    const setDetailPanelOpen = vi.fn();
    mutateAsync.mockResolvedValue({
      ...client,
      name: "Ada Byron",
    });

    renderPanel({ onClientUpdated, setDetailPanelOpen });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Full name *");
    await user.clear(nameInput);
    await user.type(nameInput, "Ada Byron");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        clientName: "Ada Byron",
        email: "ada@example.com",
        phone: "+37361111111",
      }),
    );
    expect(onClientUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Byron" }));
    expect(setDetailPanelOpen).toHaveBeenCalledWith(false);
  });

  it("shows a clear empty state when the client has no orders", async () => {
    renderPanel({ getClientOrders: () => [] });

    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("Orders for this client will show up here.")).toBeInTheDocument();
  });

  it("lists order history with number, date, status, and total", async () => {
    renderPanel({ getClientOrders: () => history });

    expect(await screen.findByText("ORD-2026-002")).toBeInTheDocument();
    expect(screen.getByText("2026-10-02")).toBeInTheDocument();
    expect(screen.getByText("MDL 80.00")).toBeInTheDocument();
    expect(screen.getByText("ORD-2026-001")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("opens a historical order from the client panel", async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    renderPanel({ getClientOrders: () => history, onOpenOrder });

    await user.click(screen.getByRole("button", { name: /ORD-2026-002/ }));

    expect(onOpenOrder).toHaveBeenCalledExactlyOnceWith("order-2");
  });

  it("hides empty optional contact fields and notes", async () => {
    renderPanel({
      selectedClient: {
        ...client,
        email: "",
        phone: "",
        address: "",
        notes: "   ",
      },
    });

    expect(await screen.findByRole("heading", { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.queryByText("Contact Information")).not.toBeInTheDocument();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
  });
});
