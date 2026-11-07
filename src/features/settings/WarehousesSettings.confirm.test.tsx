import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { WarehousesSettings } from "./WarehousesSettings";

const softDeleteMutate = vi.hoisted(() => vi.fn());

vi.mock("../warehouses/useGetWarehouses", () => ({
  useGetWarehouses: () => ({
    data: [
      {
        id: "wh-1",
        name: "Shop",
        warehouseType: "location",
        locationId: null,
        isDefault: false,
        isActive: true,
      },
    ],
    isLoading: false,
    error: null,
  }),
  useGetBinLocations: () => ({ data: [] }),
}));

vi.mock("../warehouses/useGetWarehouseStock", () => ({
  useGetWarehouseStock: () => ({ data: [] }),
}));

vi.mock("../locations/useGetLocations", () => ({
  useGetLocations: () => ({ data: [] }),
}));

vi.mock("../warehouses/useWarehouseMutations", () => ({
  useCreateWarehouse: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateWarehouse: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultWarehouse: () => ({ mutate: vi.fn(), isPending: false }),
  useSoftDeleteWarehouse: () => ({ mutate: softDeleteMutate, isPending: false }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useCanEditWorkspaceSettings: () => true,
}));

describe("WarehousesSettings delete confirm", () => {
  beforeEach(() => {
    softDeleteMutate.mockReset();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("asks via the custom dialog and deletes only after confirm", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WarehousesSettings />);

    await user.click(screen.getByRole("button", { name: /Delete warehouse/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Soft-delete warehouse "Shop"/i)).toBeInTheDocument();
    expect(softDeleteMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(softDeleteMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Delete warehouse/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(softDeleteMutate).toHaveBeenCalledWith("wh-1"));
  });
});
