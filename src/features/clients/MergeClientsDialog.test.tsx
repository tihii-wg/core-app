import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Client } from "../../lib/types";
import { MergeClientsDialog } from "./MergeClientsDialog";

const mergeClients = vi.hoisted(() => vi.fn());
const mergeClientsPreview = vi.hoisted(() => vi.fn());
const getClients = vi.hoisted(() => vi.fn());
const getClient = vi.hoisted(() => vi.fn());
const getClientVehicles = vi.hoisted(() => vi.fn());
const guardWrite = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiClients", () => ({
  getClients: (...args: unknown[]) => getClients(...args),
  getClient: (...args: unknown[]) => getClient(...args),
  mergeClients: (...args: unknown[]) => mergeClients(...args),
  mergeClientsPreview: (...args: unknown[]) => mergeClientsPreview(...args),
}));

vi.mock("../../services/apiVehicles", () => ({
  getClientVehicles: (...args: unknown[]) => getClientVehicles(...args),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useGuardSubscriptionWrite: () => guardWrite,
  useWorkspaceSubscription: () => ({ canWrite: true }),
}));

vi.mock("react-hot-toast", () => ({
  default: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const ada: Client = {
  id: "client-ada",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+37361111111",
  address: "",
  balance: 0,
  created_at: "2024-07-01T10:00:00.000Z",
  notes: "",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

const grace: Client = {
  id: "client-grace",
  name: "Grace Hopper",
  email: "grace@example.com",
  phone: "+37362222222",
  address: "",
  balance: 10,
  created_at: "2024-07-02T10:00:00.000Z",
  notes: "",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

describe("MergeClientsDialog", () => {
  beforeEach(() => {
    getClients.mockResolvedValue([ada, grace]);
    getClientVehicles.mockResolvedValue([]);
    mergeClientsPreview.mockResolvedValue({
      orders: 3,
      vehicles: 1,
      invoices: 0,
      payments: 2,
      ordersOpen: 1,
      ordersClosed: 2,
      counts: {},
      sourceNotes: [{ id: grace.id, name: grace.name, phone: grace.phone, email: grace.email }],
    });
    mergeClients.mockResolvedValue(ada.id);
    getClient.mockResolvedValue({ ...ada, name: "Merged Client" });
    guardWrite.mockClear();
  });

  it("selects 2 clients, sets name, confirms, and calls merge rpc with right args", async () => {
    const user = userEvent.setup();
    const onMerged = vi.fn();
    const onClose = vi.fn();
    const orderCountByClientId = new Map<string, number>([
      [ada.id, 2],
      [grace.id, 1],
    ]);

    renderWithQuery(
      <MergeClientsDialog
        open
        onClose={onClose}
        clients={[ada, grace]}
        orderCountByClientId={orderCountByClientId}
        onMerged={onMerged}
      />,
    );

    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("checkbox", { name: /Ada Lovelace/i }));
    await user.click(screen.getByRole("checkbox", { name: /Grace Hopper/i }));

    await user.click(screen.getByRole("button", { name: /Next|Далее|Înainte/i }));

    await waitFor(() => expect(mergeClientsPreview).toHaveBeenCalled());
    expect(mergeClientsPreview).toHaveBeenCalledWith("ws-1", ada.id, [grace.id]);

    const nameInput = await screen.findByLabelText(/Client name|Имя клиента|Nume client/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Merged Client");

    await user.click(screen.getByRole("button", { name: /Next|Далее|Înainte/i }));
    await screen.findByText(/cannot be undone|нельзя отменить|nu poate fi anulată/i);

    await user.click(screen.getByRole("button", { name: /Merge|Объединить|Unește/i }));

    await waitFor(() =>
      expect(mergeClients).toHaveBeenCalledWith("ws-1", ada.id, [grace.id], "Merged Client"),
    );
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(expect.objectContaining({ id: ada.id, name: "Merged Client" })));
    expect(onClose).toHaveBeenCalled();
  });
  it("preselects the initial client and keeps it as the main client", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithQuery(
      <MergeClientsDialog
        open
        onClose={onClose}
        clients={[ada, grace]}
        orderCountByClientId={new Map([[ada.id, 0], [grace.id, 9]])}
        initialTargetClientId={ada.id}
        onMerged={vi.fn()}
      />,
    );

    await screen.findByText("Grace Hopper");
    expect(screen.getByRole("checkbox", { name: /Ada Lovelace/i })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Grace Hopper/i }));
    await user.click(screen.getByRole("button", { name: /Next|Далее|Înainte/i }));

    // Grace has more orders, but the card's client stays the target.
    await waitFor(() => expect(mergeClientsPreview).toHaveBeenCalledWith("ws-1", ada.id, [grace.id]));
  });
});
