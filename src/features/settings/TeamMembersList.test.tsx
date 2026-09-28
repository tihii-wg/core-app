import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { TeamMembersList } from "./Settings";

const membersState = vi.hoisted(() => ({
  current: { members: undefined as unknown, isLoading: false, error: null as Error | null },
}));

vi.mock("../workspaces/useGetWorkspaceMembers", () => ({
  useGetWorkspaceMembers: () => membersState.current,
}));

describe("TeamMembersList", () => {
  beforeEach(() => {
    membersState.current = { members: undefined, isLoading: false, error: null };
  });

  it("shows workspace members with their access role", () => {
    membersState.current.members = [
      { userId: "user-1", role: "owner", fullName: "Ada Lovelace", email: "ada@example.com", isCurrentUser: true },
      { userId: "user-2", role: "member", fullName: null, email: null, isCurrentUser: false },
    ];

    renderWithQuery(<TeamMembersList />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Workspace member")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getAllByText("Active")).toHaveLength(2);
  });

  it("shows loading, error, and empty states", () => {
    membersState.current.isLoading = true;
    const { unmount } = renderWithQuery(<TeamMembersList />);
    expect(screen.getByText("Loading team members...")).toBeInTheDocument();
    unmount();

    membersState.current = { members: undefined, isLoading: false, error: new Error("permission denied") };
    const errorView = renderWithQuery(<TeamMembersList />);
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    errorView.unmount();

    membersState.current = { members: [], isLoading: false, error: null };
    renderWithQuery(<TeamMembersList />);
    expect(screen.getByText("No team members yet")).toBeInTheDocument();
  });
});
