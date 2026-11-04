import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Client } from "../../lib/types";
import ClientCombobox from "./ClientCombobox";

const pavelA: Client = {
  id: "client-a",
  name: "Pavel",
  email: "",
  phone: "+37369111111",
  address: "",
  balance: 0,
  created_at: "",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

const pavelB: Client = {
  ...pavelA,
  id: "client-b",
  phone: "+37368222222",
};

describe("ClientCombobox duplicate names", () => {
  it("keeps the list closed until focus and lists every matching client by id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreateRequest = vi.fn();
    const onChange = vi.fn();

    const { rerender } = renderWithQuery(
      <ClientCombobox
        clients={[pavelA, pavelB]}
        value="Pav"
        onChange={onChange}
        onSelect={onSelect}
        onCreateRequest={onCreateRequest}
      />,
    );

    expect(screen.queryByText("+37369111111")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /^Client$/i }));

    expect(screen.getByText("+37369111111")).toBeInTheDocument();
    expect(screen.getByText("+37368222222")).toBeInTheDocument();
    expect(screen.getAllByText("Pavel")).toHaveLength(2);

    await user.click(screen.getByText("+37368222222"));
    expect(onSelect).toHaveBeenCalledWith(pavelB);
    expect(screen.queryByText("+37369111111")).not.toBeInTheDocument();

    onCreateRequest.mockClear();
    rerender(
      <ClientCombobox
        clients={[pavelA, pavelB]}
        value="Pavel"
        onChange={onChange}
        onSelect={onSelect}
        onCreateRequest={onCreateRequest}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /^Client$/i }));
    await user.click(screen.getByRole("button", { name: /Create new client/i }));
    expect(onCreateRequest).toHaveBeenCalledWith("Pavel");
  });
});
