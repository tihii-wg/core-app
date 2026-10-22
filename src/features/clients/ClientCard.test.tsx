import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "../../lib/types";
import { ClientCard } from "./ClientCard";

const client: Client = {
  id: "client-1",
  name: "Alexandru Constantin Popescu-Mare",
  email: "alexandru.constantin@example-long-domain.com",
  phone: "+373 600 000 000",
  address: "",
  balance: 250,
  created_at: "2026-10-01T10:00:00.000Z",
  notes: "",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

function renderCard() {
  const onView = vi.fn();
  const onEdit = vi.fn();
  render(<ClientCard client={client} ordersCount={3} formatMoney={(v) => `MDL ${v.toFixed(2)}`} onView={onView} onEdit={onEdit} />);
  return { onView, onEdit };
}

describe("ClientCard", () => {
  it("shows name, contacts, orders count and balance", () => {
    renderCard();
    expect(screen.getByText("Alexandru Constantin Popescu-Mare")).toBeInTheDocument();
    expect(screen.getByText("+373 600 000 000")).toBeInTheDocument();
    expect(screen.getByText("alexandru.constantin@example-long-domain.com")).toBeInTheDocument();
    expect(screen.getByText("MDL 250.00")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("opens details from the card and keeps the menu independent", async () => {
    const user = userEvent.setup();
    const { onView, onEdit } = renderCard();

    const trigger = screen.getByRole("button", { name: "Actions for client Alexandru Constantin Popescu-Mare" });
    expect(trigger.className).toContain("size-10");
    await user.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(onView).not.toHaveBeenCalled();

    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "client-1" }));
    expect(onView).not.toHaveBeenCalled();

    await user.click(screen.getByText("+373 600 000 000"));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: "client-1" }));
  });
});
