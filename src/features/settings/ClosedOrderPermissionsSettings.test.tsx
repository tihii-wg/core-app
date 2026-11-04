import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { ClosedOrderPermissionsSettings } from "./ClosedOrderPermissionsSettings";

const grantsFixture = vi.hoisted(() => ({
  cancelClosed: ["admin"] as ("admin" | "manager" | "member")[],
  deleteClosed: ["manager"] as ("admin" | "manager" | "member")[],
}));

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
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

const workspace = {
  id: "ws-1",
  name: "Core",
  role: "owner",
} as WorkspaceDetails;

describe("ClosedOrderPermissionsSettings", () => {
  it("renders for the workspace owner with both permission groups", () => {
    renderWithQuery(<ClosedOrderPermissionsSettings workspace={workspace} />);
    expect(screen.getByText("Closed Order Permissions")).toBeInTheDocument();
    expect(screen.getByText("Cancel closed orders")).toBeInTheDocument();
    expect(screen.getByText("Delete closed orders")).toBeInTheDocument();
    expect(screen.getByText(/owner always retains both permissions/i)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(6);
  });

  it("hides the section from non-owners", () => {
    const { container } = renderWithQuery(
      <ClosedOrderPermissionsSettings workspace={{ ...workspace, role: "admin" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
