import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { ClosedOrderPermissionsSettings } from "./ClosedOrderPermissionsSettings";

const grantsFixture = vi.hoisted(() => ({
  cancelClosed: ["admin"] as const,
  deleteClosed: ["manager"] as const,
}));

const ownerIdState = vi.hoisted(() => ({ isOwner: true }));

vi.mock("../orders/useClosedOrderPermissions", () => ({
  useClosedOrderPermissionGrants: () => ({
    data: grantsFixture,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSaveClosedOrderPermissionGrants: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSaveOwnerCanManageClosedOrders: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => ownerIdState.isOwner,
}));

const workspace = {
  id: "ws-1",
  name: "Core",
  role: "owner",
  ownerCanManageClosedOrders: false,
} as WorkspaceDetails;

describe("ClosedOrderPermissionsSettings", () => {
  it("renders for the workspace owner with manage toggle and permission groups", () => {
    ownerIdState.isOwner = true;
    renderWithQuery(<ClosedOrderPermissionsSettings workspace={workspace} />);
    expect(screen.getByText("Closed Order Permissions")).toBeInTheDocument();
    expect(screen.getByText("Allow owner to manage closed orders")).toBeInTheDocument();
    expect(screen.getByText("Cancel closed orders")).toBeInTheDocument();
    expect(screen.getByText("Delete closed orders")).toBeInTheDocument();
    expect(screen.getByText(/owner always retains both permissions/i)).toBeInTheDocument();
    // 1 owner-manage toggle + 3 cancel roles + 3 delete roles
    expect(screen.getAllByRole("switch")).toHaveLength(7);
  });

  it("hides the section from non-owners even when membership role is owner", () => {
    ownerIdState.isOwner = false;
    const { container } = renderWithQuery(
      <ClosedOrderPermissionsSettings workspace={{ ...workspace, role: "owner" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
