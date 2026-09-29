import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../tests/renderQuery";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AddNewOrderForm from "./AddNewOrderForm";

const employeesState = vi.hoisted(() => ({
  employees: [] as { id: string; name: string; status: string; role: string }[],
  role: "owner" as string | null,
}));

vi.mock("./useCreateOrder", () => ({
  useCreateOrder: () => ({
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("../clients/useGetClients", () => ({
  useGetClients: () => ({ clients: [] }),
}));

vi.mock("../services/useGetServices", () => ({
  default: () => ({ services: [] }),
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees: employeesState.employees }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useGetProfile: () => ({ data: undefined }),
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => employeesState.role,
}));

describe("AddNewOrderForm client validation", () => {
  beforeEach(() => {
    employeesState.employees = [];
    employeesState.role = "owner";
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("marks the client field when Create Order is clicked with an empty form", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.click(screen.getByRole("button", { name: "Create Order" }));

    expect(await screen.findByText("Client is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Client *")).toHaveClass("border-[#f41f20]");
    expect(screen.getByText("Car is required")).toBeInTheDocument();
    expect(screen.getByText("Car number is required")).toBeInTheDocument();
  });

  it("clears the client warning after a name is entered", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.click(screen.getByRole("button", { name: "Create Order" }));
    expect(await screen.findByText("Client is required")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Client *"), "Ada");

    expect(screen.queryByText("Client is required")).not.toBeInTheDocument();
  });

  it("requires the VIN to contain exactly 17 characters", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.type(screen.getByLabelText("VIN *"), "ABC123");
    await user.click(screen.getByRole("button", { name: "Create Order" }));

    expect(await screen.findByText("VIN must contain exactly 17 characters")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("VIN *"));
    await user.type(screen.getByLabelText("VIN *"), "1HGBH41JXMN109186");
    await user.click(screen.getByRole("button", { name: "Create Order" }));

    expect(screen.queryByText("VIN must contain exactly 17 characters")).not.toBeInTheDocument();
  });

  it("adds a custom service to the order", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.type(screen.getByLabelText("Service *"), "Wheel alignment");
    await user.type(screen.getByLabelText("Price"), "45");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Wheel alignment")).toBeInTheDocument();
    expect(screen.getAllByText("MDL 45.00")).toHaveLength(2);
  });

  it("does not offer to create a catalogue service for view-only roles", async () => {
    employeesState.role = "member";
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.type(screen.getByLabelText("Service *"), "Wheel alignment");

    expect(screen.queryByText(/Create:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("keeps the assigned employee select controlled after a choice", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    employeesState.employees = [{ id: "emp-1", name: "Ada", status: "active", role: "technician" }];
    const user = userEvent.setup();
    renderWithQuery(<AddNewOrderForm setCreateModalOpen={() => {}} searchQuery="" />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Ada" }));

    expect(screen.getByRole("combobox")).toHaveTextContent("Ada");
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("uncontrolled");
    consoleError.mockRestore();
  });
});
