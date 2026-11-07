import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { LocationsSettings } from "./LocationsSettings";

const deleteMutate = vi.hoisted(() => vi.fn());

vi.mock("../locations/useGetLocations", () => ({
  useGetLocations: () => ({
    data: [
      {
        id: "loc-1",
        name: "Main",
        address: null,
        phone: null,
        color: null,
        code: null,
        isDefault: false,
        isActive: true,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../locations/useLocationMutations", () => ({
  useCreateLocation: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultLocation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLocation: () => ({ mutate: deleteMutate, isPending: false }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useCanEditWorkspaceSettings: () => true,
}));

describe("LocationsSettings delete confirm", () => {
  beforeEach(() => {
    deleteMutate.mockReset();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("asks via the custom dialog and deletes only after confirm", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LocationsSettings />);

    await user.click(screen.getByRole("button", { name: /Delete location/i }));
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText(/Delete location "Main"/i)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Delete location/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith("loc-1"));
    expect(dialog).toBeTruthy();
  });
});
