import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { TeamMembersList } from "./Settings";

const employeesState = vi.hoisted(() => ({
  current: { employees: undefined as unknown, isLoading: false, error: null as Error | null },
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => employeesState.current,
}));

describe("TeamMembersList", () => {
  beforeEach(() => {
    employeesState.current = { employees: undefined, isLoading: false, error: null };
  });

  it("shows workspace employees", () => {
    employeesState.current.employees = [
      { id: "emp-1", name: "Ada Lovelace", email: "ada@example.com", role: "technician", status: "active" },
      { id: "emp-2", name: "Alan Turing", email: "alan@example.com", role: "manager", status: "inactive" },
    ];

    renderWithQuery(<TeamMembersList />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Alan Turing")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });

  it("shows loading, error, and empty states", () => {
    employeesState.current.isLoading = true;
    const { unmount } = renderWithQuery(<TeamMembersList />);
    expect(screen.getByText("Loading team members...")).toBeInTheDocument();
    unmount();

    employeesState.current = { employees: undefined, isLoading: false, error: new Error("permission denied") };
    const errorView = renderWithQuery(<TeamMembersList />);
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    errorView.unmount();

    employeesState.current = { employees: [], isLoading: false, error: null };
    renderWithQuery(<TeamMembersList />);
    expect(screen.getByText("No team members yet")).toBeInTheDocument();
  });
});
