import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { TeamSettings } from "./TeamSettings";
import type { WorkspaceTeamMember } from "../../services/apiWorkspaces";

const state = vi.hoisted(() => ({
  members: { workspaceId: "ws-1" as string | undefined, members: undefined as unknown, isLoading: false, error: null as Error | null },
  updateRole: vi.fn(),
  removeMember: vi.fn(),
  addMember: vi.fn(),
}));

vi.mock("../workspaces/useGetWorkspaceMembers", () => ({
  useGetWorkspaceMembers: () => state.members,
}));

vi.mock("../workspaces/useManageWorkspaceMembers", () => ({
  useUpdateWorkspaceMemberRole: () => ({ mutate: state.updateRole, isPending: false, variables: undefined }),
  useRemoveWorkspaceMember: () => ({ mutateAsync: state.removeMember, isPending: false }),
  useAddWorkspaceMember: () => ({ mutateAsync: state.addMember, isPending: false }),
}));

function member(userId: string, role: string, fullName: string, isCurrentUser = false): WorkspaceTeamMember {
  return { userId, role, fullName, email: `${userId}@example.com`, createdAt: null, isCurrentUser };
}

const team = (currentRole: string) => [
  member("owner-1", "owner", "Olga Owner", currentRole === "owner"),
  member("admin-1", "admin", "Adam Admin", currentRole === "admin"),
  member("admin-2", "admin", "Alice Admin"),
  member("manager-1", "manager", "Mia Manager", currentRole === "manager"),
  member("member-1", "member", "Max Member", currentRole === "member"),
];

function row(name: string) {
  return screen.getByText(name).closest("div.rounded-lg") as HTMLElement;
}

describe("TeamSettings", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
    state.members = { workspaceId: "ws-1", members: undefined, isLoading: false, error: null };
    state.updateRole.mockReset();
    state.removeMember.mockReset().mockResolvedValue({});
    state.addMember.mockReset().mockResolvedValue({});
  });

  it("lets an owner manage every member except the owner", () => {
    state.members.members = team("owner");
    renderWithQuery(<TeamSettings />);

    expect(screen.getByRole("button", { name: "Invite Member" })).toBeInTheDocument();
    expect(within(row("Olga Owner")).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(within(row("Olga Owner")).getByText("Owner")).toBeInTheDocument();
    for (const name of ["Adam Admin", "Alice Admin", "Mia Manager", "Max Member"]) {
      expect(within(row(name)).getByRole("button", { name: "Remove" })).toBeInTheDocument();
      expect(within(row(name)).getByRole("combobox", { name: `Role for ${name}` })).toBeInTheDocument();
    }
  });

  it("lets an admin manage only managers and members", () => {
    state.members.members = team("admin");
    renderWithQuery(<TeamSettings />);

    expect(screen.getByRole("button", { name: "Invite Member" })).toBeInTheDocument();
    for (const name of ["Olga Owner", "Adam Admin", "Alice Admin"]) {
      expect(within(row(name)).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
      expect(within(row(name)).queryByRole("combobox")).not.toBeInTheDocument();
    }
    for (const name of ["Mia Manager", "Max Member"]) {
      expect(within(row(name)).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    }
  });

  it("gives managers and members a read-only list", () => {
    for (const role of ["manager", "member"]) {
      state.members.members = team(role);
      const view = renderWithQuery(<TeamSettings />);

      expect(screen.queryByRole("button", { name: "Invite Member" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.getByText("Olga Owner")).toBeInTheDocument();
      view.unmount();
    }
  });

  it("removes a member after confirmation", async () => {
    const user = userEvent.setup();
    state.members.members = team("owner");
    renderWithQuery(<TeamSettings />);

    await user.click(within(row("Max Member")).getByRole("button", { name: "Remove" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));

    expect(state.removeMember).toHaveBeenCalledWith({ workspaceId: "ws-1", userId: "member-1" });
  });

  it("adds a member by email with a role the current user may assign", async () => {
    const user = userEvent.setup();
    state.members.members = team("admin");
    renderWithQuery(<TeamSettings />);

    await user.click(screen.getByRole("button", { name: "Invite Member" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Role" }));
    expect(screen.queryByRole("option", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Manager" }));
    await user.type(within(dialog).getByLabelText("Email"), "new@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));

    expect(state.addMember).toHaveBeenCalledWith({ workspaceId: "ws-1", email: "new@example.com", role: "manager" });
  });

  it("shows loading, error, and empty states", () => {
    state.members.isLoading = true;
    const loading = renderWithQuery(<TeamSettings />);
    expect(screen.getByText("Loading team members...")).toBeInTheDocument();
    loading.unmount();

    state.members = { workspaceId: "ws-1", members: undefined, isLoading: false, error: new Error("permission denied") };
    const failed = renderWithQuery(<TeamSettings />);
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    failed.unmount();

    state.members = { workspaceId: "ws-1", members: [], isLoading: false, error: null };
    renderWithQuery(<TeamSettings />);
    expect(screen.getByText("No team members yet")).toBeInTheDocument();
  });
});
