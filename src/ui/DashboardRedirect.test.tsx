import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../tests/renderQuery";
import Dashboardredirect from "./DashboardRedirect";

const navigate = vi.fn();
const updateWorkspace = vi.fn();
const workspacesState = vi.hoisted(() => ({
  workspaces: [] as { workspaces: { id: string } }[],
  refetch: vi.fn(),
}));
const profileState = vi.hoisted(() => ({
  profile: { id: "u1", email: "join@example.com", active_workspace_id: null as string | null },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ locale: "en" }),
  };
});

vi.mock("../features/profiles/useGetProfile", () => ({
  useGetProfile: () => ({ data: profileState.profile, isLoading: false, error: null }),
}));

vi.mock("../features/workspaces/useGetWorkspaces", () => ({
  useGetWorkspaces: () => ({
    workspaces: workspacesState.workspaces,
    isLoading: false,
    error: null,
    refetch: workspacesState.refetch,
  }),
  listedWorkspaceIds: (memberships: { workspaces?: { id: string } | { id: string }[] }[] | undefined) =>
    (memberships ?? []).flatMap((item) => {
      const workspace = item.workspaces;
      if (!workspace) return [];
      return Array.isArray(workspace) ? workspace.map((entry) => entry.id) : [workspace.id];
    }),
}));

vi.mock("../features/workspaces/useSetActiveWorkspace", () => ({
  useSetActiveWorkspace: () => ({ updateWorkspace }),
}));

vi.mock("../features/auth/useLogOut", () => ({
  useLogOut: () => ({ logOut: vi.fn(), isLoading: false }),
}));

vi.mock("../features/auth/useUser", () => ({
  useUser: () => ({ user: { email: "join@example.com" } }),
}));

vi.mock("../features/workspaces/AddNewWorkspaceForm", () => ({
  default: () => <div data-testid="create-workspace-form" />,
}));

describe("DashboardRedirect waiting screen", () => {
  it("shows waiting-for-invite UI when the user has no workspaces", () => {
    workspacesState.workspaces = [];
    profileState.profile = { id: "u1", email: "join@example.com", active_workspace_id: null };
    renderWithQuery(<Dashboardredirect />);

    expect(screen.getByText("Waiting for an invitation")).toBeInTheDocument();
    expect(screen.getByText("join@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create my own workspace/i })).toBeInTheDocument();
  });

  it("redirects once a membership appears and active workspace is missing", async () => {
    navigate.mockClear();
    updateWorkspace.mockResolvedValue("ws-1");
    workspacesState.workspaces = [{ workspaces: { id: "ws-1" } }];
    profileState.profile = { id: "u1", email: "join@example.com", active_workspace_id: null };

    renderWithQuery(<Dashboardredirect />);

    await waitFor(() => expect(updateWorkspace).toHaveBeenCalledWith("ws-1"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/en/ws-1/dashboard", { replace: true }));
  });
});
