import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { TeamSettings } from "./TeamSettings";
import { accountNotFoundError } from "../../services/apiWorkspaces";

const addMember = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ locale: "en", workspaceId: "ws-1" }),
  };
});

vi.mock("../workspaces/useGetWorkspaceMembers", () => ({
  useGetWorkspaceMembers: () => ({
    workspaceId: "ws-1",
    members: [{ userId: "owner-1", role: "owner", isCurrentUser: true, fullName: "Olga", email: "o@x.com" }],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../workspaces/useManageWorkspaceMembers", () => ({
  useAddWorkspaceMember: () => ({ mutateAsync: addMember, isPending: false }),
  useRemoveWorkspaceMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWorkspaceMemberRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true }),
}));

vi.mock("../workspaces/SubscriptionReadOnlyNotice", () => ({
  SubscriptionReadOnlyNotice: () => null,
}));

describe("AddTeamMemberDialog accountNotFound", () => {
  it("shows a join registration link when the email is not registered", async () => {
    const user = userEvent.setup();
    addMember.mockRejectedValueOnce(accountNotFoundError());

    renderWithQuery(<TeamSettings />);

    await user.click(screen.getByRole("button", { name: "Invite Member" }));
    await user.type(screen.getByLabelText("Email"), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    await waitFor(() => expect(screen.getByTestId("team-invite-register-link")).toBeInTheDocument());
    expect(screen.getByText(/not registered in Core App/i)).toBeInTheDocument();
    expect(screen.getByText(/\/en\/register\?mode=join&email=newbie%40example\.com/)).toBeInTheDocument();
  });
});
