import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import type { InventoryItem, OrderMaterial } from "../../lib/types";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";

type EditorProps = ComponentProps<typeof OrderMaterialLinesEditor>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === "orders.form.availableOnWarehouse") {
        return `Available on warehouse «${opts?.warehouse}»: ${opts?.count}`;
      }
      if (key === "orders.form.onlyNAvailableOnWarehouse") {
        return `Only ${opts?.available} available on warehouse «${opts?.warehouse}»`;
      }
      if (key === "orders.form.setToMaximum") return `Set to maximum (${opts?.available})`;
      if (key === "orders.form.cannotAddZeroStock") {
        return `No stock on warehouse «${opts?.warehouse}»`;
      }
      const map: Record<string, string> = {
        "orders.form.materialsSection": "Materials",
        "orders.form.materialSourceAria": "Source",
        "orders.form.materialSourceCatalog": "Catalog",
        "orders.form.materialSourceOneTime": "One-time",
        "orders.form.materialSourceCustomer": "Customer",
        "orders.form.quantityLabel": "Qty",
        "orders.form.quantityForMaterial": "Quantity for Pad",
        "orders.form.decreaseQuantity": "Decrease",
        "orders.form.increaseQuantity": "Increase",
        "orders.form.remove": "Remove",
        "orders.form.removeMaterial": "Remove Pad",
        "orders.form.willDeductOnSave": "Deduct on save",
        "orders.form.issueWarehouseLabel": "Warehouse",
        "orders.form.immediateIssueHint": "Hint",
        "orders.form.materialsImmediateHint": "Immediate",
        "orders.form.receiveStock": "Receive",
        "orders.detail.amount": "Amount",
        "orders.detail.price": "Price",
        "orders.validation.quantityMaxDecimals": "No more than 2 decimal places",
        "orders.validation.quantityMin": "Quantity must be greater than 0",
        "orders.validation.quantityRequired": "Enter a quantity",
        "orders.warehouse.warehousePlaceholder": "Warehouse",
        "orders.warehouse.warehouseRequired": "Warehouse required",
        "orders.form.outOfStockOnWarehouse": "Out of stock",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../warehouses/useGetWarehouses", () => ({
  useGetWarehouses: () => ({
    data: [{ id: "wh-1", name: "Main", isActive: true, isDefault: true, deletedAt: null }],
  }),
}));

const stockState = vi.hoisted(() => ({
  rows: [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 2 }],
}));

vi.mock("../warehouses/useGetWarehouseStock", () => ({
  useGetWarehouseStock: () => ({
    data: stockState.rows,
    isSuccess: true,
  }),
}));

vi.mock("./useOrderMaterialFreeformSupport", () => ({
  useOrderMaterialFreeformSupport: () => ({ supported: true, ready: true }),
}));

vi.mock("../industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({
    copy: { materialSourceCustomer: "Customer part", materialSearchPlaceholder: "Search" },
  }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => String(n) }),
}));

vi.mock("../inventory/InventoryItemCombobox", () => ({
  default: ({
    onSelect,
    onSelectOutOfStock,
  }: {
    onSelect?: (item: InventoryItem) => void;
    onSelectOutOfStock?: (item: InventoryItem) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="pick-in-stock"
        onClick={() =>
          onSelect?.({
            id: "item-1",
            name: "Pad",
            sku: "P1",
            category: "",
            unit: "pcs",
            quantity: 2,
            sellingPrice: 10,
            purchasePrice: 5,
            isActive: true,
          } as InventoryItem)
        }
      >
        Pick
      </button>
      <button
        type="button"
        data-testid="pick-zero-stock"
        onClick={() =>
          onSelectOutOfStock?.({
            id: "item-2",
            name: "Empty",
            sku: "E1",
            category: "",
            unit: "pcs",
            quantity: 0,
            sellingPrice: 1,
            purchasePrice: 1,
            isActive: true,
          } as InventoryItem)
        }
      >
        Zero
      </button>
    </div>
  ),
}));

vi.mock("../inventory/AddInventoryItemDialog", () => ({
  AddInventoryItemDialog: () => null,
}));

vi.mock("../inventory/QuickGoodsReceiptDialog", () => ({
  QuickGoodsReceiptDialog: () => null,
}));

function Harness({
  initial,
}: {
  initial: OrderMaterial[];
}) {
  const form = useForm<{ materials: OrderMaterial[] }>({
    defaultValues: { materials: initial },
    mode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "materials" });
  const props = {
    control: form.control as EditorProps["control"],
    fields,
    append: append as EditorProps["append"],
    remove,
    setValue: form.setValue as EditorProps["setValue"],
    getValues: form.getValues as EditorProps["getValues"],
    trigger: form.trigger as EditorProps["trigger"],
    inventoryItems: [
      {
        id: "item-1",
        name: "Pad",
        sku: "P1",
        category: "",
        unit: "pcs",
        quantity: 2,
        sellingPrice: 10,
        purchasePrice: 5,
        isActive: true,
      } as InventoryItem,
    ],
    isSubmitted: true,
    errors: form.formState.errors.materials as EditorProps["errors"],
  };
  return (
    <FormProvider {...form}>
      <OrderMaterialLinesEditor {...props} />
    </FormProvider>
  );
}

describe("OrderMaterialLinesEditor stock limits", () => {
  it("shows available stock and blocks the + stepper past the max", async () => {
    const user = userEvent.setup();
    stockState.rows = [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 2 }];
    render(
      <Harness
        initial={[
          {
            id: "m1",
            itemName: "Pad",
            price: 10,
            quantity: 2,
            quantityIssued: 2,
            quantityReturned: 0,
            supplySource: "catalog",
            inventoryItemId: "item-1",
            warehouseId: "wh-1",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("material-line-available-0")).toHaveTextContent(/Available on warehouse/);
    const increase = screen.getByRole("button", { name: "Increase" });
    // max = onHand 2 + outstanding 2 = 4; current 2 → can increase
    await user.click(increase);
    await user.click(increase);
    // now at 4 = max; further + disabled
    expect(increase).toBeDisabled();
  });

  it("shows only-N warning when typing above max and offers set-to-max", async () => {
    const user = userEvent.setup();
    stockState.rows = [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 1 }];
    render(
      <Harness
        initial={[
          {
            id: "m1",
            itemName: "Pad",
            price: 10,
            quantity: 2,
            quantityIssued: 2,
            quantityReturned: 0,
            supplySource: "catalog",
            inventoryItemId: "item-1",
            warehouseId: "wh-1",
          },
        ]}
      />,
    );

    const input = screen.getByLabelText("Quantity for Pad");
    await user.clear(input);
    await user.type(input, "9");
    await user.tab();
    await waitFor(() => expect(screen.getByTestId("material-qty-stock-warning-0")).toBeInTheDocument());
    expect(screen.getByTestId("material-qty-set-max-0")).toBeInTheDocument();
    await user.click(screen.getByTestId("material-qty-set-max-0"));
    await waitFor(() => expect(input).toHaveValue("3"));
  });

  it("explains why a zero-stock item cannot be added", async () => {
    const user = userEvent.setup();
    stockState.rows = [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 2 }];
    render(<Harness initial={[]} />);
    await user.click(screen.getByTestId("pick-zero-stock"));
    expect(screen.getByTestId("material-add-stock-error")).toHaveTextContent(/No stock on warehouse/);
  });
});
