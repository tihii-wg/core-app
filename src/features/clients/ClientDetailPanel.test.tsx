import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "../../lib/types";
import ClientDetailPanel from "./ClientDetailPanel";

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("./useUpdateClient", () => ({
  useUpdateClient: () => ({
    mutateAsync,
    isPending: false,
  }),
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
};

function renderPanel(onClientUpdated = vi.fn(), setDetailPanelOpen = vi.fn()) {
  render(
    <ClientDetailPanel
      selectedClient={client}
      detailPanelOpen
      setDetailPanelOpen={setDetailPanelOpen}
      onClientUpdated={onClientUpdated}
      getClientOrders={() => []}
    />,
  );

  return { setDetailPanelOpen };
}

describe("ClientDetailPanel", () => {
  it("opens with a description and an edit button", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderPanel();

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
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

    renderPanel(onClientUpdated, setDetailPanelOpen);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Name *");
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
});
