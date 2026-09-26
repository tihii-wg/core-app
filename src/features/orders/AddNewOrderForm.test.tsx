import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AddNewOrderForm from "./AddNewOrderForm";

vi.mock("../clients/useGetClients", () => ({
  useGetClients: () => ({ clients: [] }),
}));

vi.mock("../services/useGetServices", () => ({
  default: () => ({ services: [] }),
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees: [] }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useGetProfile: () => ({ data: undefined }),
}));

describe("AddNewOrderForm client validation", () => {
  it("marks the client field when Create Order is clicked with an empty form", async () => {
    const user = userEvent.setup();
    render(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.click(screen.getByRole("button", { name: "Create Order" }));

    expect(await screen.findByText("Client is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Client *")).toHaveClass("border-[#f41f20]");
    expect(screen.getByText("Car is required")).toBeInTheDocument();
  });

  it("clears the client warning after a name is entered", async () => {
    const user = userEvent.setup();
    render(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.click(screen.getByRole("button", { name: "Create Order" }));
    expect(await screen.findByText("Client is required")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Client *"), "Ada");

    expect(screen.queryByText("Client is required")).not.toBeInTheDocument();
  });
});
