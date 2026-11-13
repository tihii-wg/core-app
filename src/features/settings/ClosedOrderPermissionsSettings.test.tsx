import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { ClosedOrderPermissionsSettings } from "./ClosedOrderPermissionsSettings";

const grantsFixture = vi.hoisted(() => ({
  cancelClosed: ["admin"] as ("admin" | "manager" | "member")[],
  deleteClosed: ["manager"] as ("admin" | "manager" | "member")[],
  closedFullAccess: ["member"] as ("admin" | "manager" | "member")[],
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
  it("renders for the workspace owner with manage toggle, full access, and permission groups", () => {
    ownerIdState.isOwner = true;
    renderWithQuery(<ClosedOrderPermissionsSettings workspace={workspace} />);
    expect(screen.getByText("Closed Order Permissions")).toBeInTheDocument();
    expect(screen.getByText("Allow the owner to cancel and delete closed orders")).toBeInTheDocument();
    expect(screen.getByText("Full access (same as owner)")).toBeInTheDocument();
    expect(screen.getByText("Cancel closed orders")).toBeInTheDocument();
    expect(screen.getByText("Delete closed orders")).toBeInTheDocument();
    expect(screen.getByText(/cancel\/delete grants are independent/i)).toBeInTheDocument();
    // 1 owner-manage + 3 full-access + 3 cancel + 3 delete
    expect(screen.getAllByRole("switch")).toHaveLength(10);
  });

  it("implies cancel/delete switches for roles with full access", () => {
    ownerIdState.isOwner = true;
    renderWithQuery(<ClosedOrderPermissionsSettings workspace={workspace} />);
    const cancelGroup = screen.getByText("Cancel closed orders").closest<HTMLElement>("div.space-y-3")!;
    const deleteGroup = screen.getByText("Delete closed orders").closest<HTMLElement>("div.space-y-3")!;
    const cancelMember = within(cancelGroup).getByRole("switch", { name: "Member" });
    const deleteMember = within(deleteGroup).getByRole("switch", { name: "Member" });
    expect(cancelMember).toBeChecked();
    expect(cancelMember).toBeDisabled();
    expect(deleteMember).toBeChecked();
    expect(deleteMember).toBeDisabled();
  });

  it("hides the section from non-owners even when membership role is owner", () => {
    ownerIdState.isOwner = false;
    const { container } = renderWithQuery(
      <ClosedOrderPermissionsSettings workspace={{ ...workspace, role: "owner" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
