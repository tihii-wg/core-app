import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import toast from "react-hot-toast";
import { CompanyLogoControls } from "./CompanyLogoControls";
import { LOGO_FILE_ERROR } from "../workspaces/workspaceAvatar";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("../workspaces/useWorkspaceAvatar", () => ({
  useWorkspaceAvatar: () => ({ data: null, isError: false }),
  useUploadWorkspaceAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveWorkspaceAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const workspace: WorkspaceDetails = {
  id: "4b8f0c3a-1111-4111-8111-111111111111",
  name: "FixFlow",
  ownerId: null,
  industryId: null,
  industryName: null,
  avatarPath: null,
  inventoryMarkup: null,
  language: "en",
  timezone: "Europe/Chisinau",
  dateFormat: "DD.MM.YYYY",
  currency: "MDL",
  role: "owner",
};

describe("Company logo controls", () => {
  it("shows workspace initials and an upload action when no logo is saved", () => {
    render(<CompanyLogoControls workspace={workspace} />);

    expect(screen.getByText("FF")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload logo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove logo" })).not.toBeInTheDocument();
  });

  it("rejects a file that is not a jpg, png, or webp image under 5 MB", () => {
    render(<CompanyLogoControls workspace={workspace} />);

    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing file input");

    fireEvent.change(input, { target: { files: [new File(["gif"], "logo.gif", { type: "image/gif" })] } });

    expect(toast.error).toHaveBeenCalledWith(LOGO_FILE_ERROR);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers change and remove when a logo is already saved", () => {
    render(<CompanyLogoControls workspace={{ ...workspace, avatarPath: `${workspace.id}/logo.webp` }} />);

    expect(screen.getByRole("button", { name: "Change logo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeInTheDocument();
  });
});
