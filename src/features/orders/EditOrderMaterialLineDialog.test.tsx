import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Order, OrderMaterial } from "../../lib/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";

const mutateAsync = vi.hoisted(() => vi.fn());
const showKm = vi.hoisted(() => ({ value: true }));
const stockRows = vi.hoisted(() => ({
  rows: [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 2 }],
}));

vi.mock("./useUpdateOrderMaterialLine", () => ({
  useUpdateOrderMaterialLine: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("../industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({
    industrySlug: "auto_repair",
    workflow: { slug: "auto_repair" },
    copy: { materialSourceCustomer: "Customer part", materialSearchPlaceholder: "Search" },
    profile: null,
  }),
}));

vi.mock("../industries/industryCapabilities", () => ({
  industryUsesMileageWarranty: () => showKm.value,
  industrySupportsClientVehicles: () => showKm.value,
}));

vi.mock("./useWorkspaceWarrantyDefaults", () => ({
  useWorkspaceWarrantyDefaults: () => ({ months: 6, days: null, km: null }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => `MDL ${n.toFixed(2)}` }),
}));

vi.mock("../inventory/useGetInventoryItems", () => ({
  useGetInventoryItems: () => ({
    items: [
      {
        id: "item-1",
        name: "Brake pad",
        sellingPrice: 40,
        purchasePrice: 20,
        isActive: true,
        unit: "pcs",
      },
    ],
  }),
}));

vi.mock("../warehouses/useGetWarehouses", () => ({
  useGetWarehouses: () => ({
    data: [{ id: "wh-1", name: "Main", isActive: true, isDefault: true, deletedAt: null }],
  }),
}));

vi.mock("../warehouses/useGetWarehouseStock", () => ({
  useGetWarehouseStock: () => ({
    data: stockRows.rows,
    isSuccess: true,
  }),
}));

vi.mock("./useOrderMaterialFreeformSupport", () => ({
  useOrderMaterialFreeformSupport: () => ({ supported: true, ready: true }),
}));

vi.mock("../inventory/QuickGoodsReceiptDialog", () => ({
  QuickGoodsReceiptDialog: () => null,
}));

vi.mock("../inventory/AddInventoryItemDialog", () => ({
  AddInventoryItemDialog: () => null,
}));

import EditOrderMaterialLineDialog from "./EditOrderMaterialLineDialog";

const line: OrderMaterial = {
  id: "mat-1",
  inventoryItemId: "item-1",
  itemName: "Brake pad",
  price: 40,
  quantity: 1,
  quantityIssued: 0,
  quantityReturned: 0,
  warehouseId: "wh-1",
  supplySource: "catalog",
  warrantyMonths: 6,
  warrantyDays: null,
  warrantyKm: 10000,
};

const order = {
  id: "order-1",
  orderNumber: "ORD-1",
  status: "in_progress",
  services: [],
  materials: [line],
  vehicleMileageUnitSnapshot: "km",
} as unknown as Order;

function renderDialog(overrides?: {
  order?: Order;
  line?: OrderMaterial;
  open?: boolean;
}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <EditOrderMaterialLineDialog
          open={overrides?.open ?? true}
          onOpenChange={onOpenChange}
          order={overrides?.order ?? order}
          line={overrides?.line ?? line}
          onSaved={onSaved}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange, onSaved };
}

describe("EditOrderMaterialLineDialog", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    showKm.value = true;
    stockRows.rows = [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 2 }];
    mutateAsync.mockResolvedValue({ ...order, materials: [{ ...line, price: 55 }] });
  });

  it("shows only one line prefilled and hides add/remove controls", async () => {
    renderDialog();
    expect(await screen.findByTestId("edit-order-material-line-submit")).toBeInTheDocument();
    expect(screen.getAllByText("Brake pad").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("add-order-lines-body").querySelector("[data-single-line='true']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity for Brake pad")).toHaveValue("1");
  });

  it("disables Save while unchanged and sends only the patched fields", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog();
    const submit = await screen.findByTestId("edit-order-material-line-submit");
    expect(submit).toBeDisabled();

    const price = screen.getByLabelText(/price/i);
    await user.clear(price);
    await user.type(price, "55");
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        orderId: "order-1",
        lineId: "mat-1",
        patch: expect.objectContaining({ price: 55 }),
      });
    });
    expect(onSaved).toHaveBeenCalled();
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.quantity).toBeUndefined();
    expect(patch.warrantyMonths).toBeUndefined();
  });

  it("shows insufficient-stock messaging and Set to maximum when qty exceeds warehouse", async () => {
    const user = userEvent.setup();
    renderDialog();
    const qty = await screen.findByLabelText("Quantity for Brake pad");
    await user.clear(qty);
    await user.type(qty, "9");
    expect(await screen.findByTestId("material-qty-stock-warning-0")).toBeInTheDocument();
    expect(screen.getByTestId("material-qty-set-max-0")).toBeInTheDocument();
  });

  it("locks the warehouse select after stock has been issued", async () => {
    renderDialog({
      line: { ...line, quantityIssued: 1, quantityReturned: 0, quantity: 1 },
      order: {
        ...order,
        materials: [{ ...line, quantityIssued: 1, quantityReturned: 0, quantity: 1 }],
      },
    });
    await screen.findByTestId("edit-order-material-line-submit");
    const warehouse = screen.getByLabelText(/warehouse|склад|depozit/i);
    expect(warehouse).toBeDisabled();
    expect(screen.getByTestId("material-warehouse-locked-hint")).toBeInTheDocument();
  });

  it("can clear warranty months in the patch", async () => {
    const user = userEvent.setup();
    renderDialog();
    const months = await screen.findByLabelText(/months/i);
    await user.clear(months);
    months.blur();
    await user.click(screen.getByTestId("edit-order-material-line-submit"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.warrantyMonths).toBeNull();
  });

  it("hides km when the industry has no mileage warranty", async () => {
    showKm.value = false;
    renderDialog({
      line: { ...line, warrantyKm: null },
      order: { ...order, materials: [{ ...line, warrantyKm: null }] },
    });
    await screen.findByTestId("edit-order-material-line-submit");
    expect(screen.queryByLabelText(/mileage|км|km/i)).not.toBeInTheDocument();
  });

  it("does not mount when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("edit-order-material-line-submit")).not.toBeInTheDocument();
  });
});
