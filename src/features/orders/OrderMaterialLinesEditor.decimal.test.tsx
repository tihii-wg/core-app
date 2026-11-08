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
    t: (key: string) => {
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
        "orders.detail.amount": "Amount",
        "orders.detail.price": "Price",
        "orders.validation.quantityMaxDecimals": "No more than 2 decimal places",
        "orders.validation.quantityMin": "Quantity must be greater than 0",
        "orders.validation.quantityRequired": "Enter a quantity",
        "orders.warehouse.warehousePlaceholder": "Warehouse",
        "orders.warehouse.warehouseRequired": "Warehouse required",
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

vi.mock("../warehouses/useGetWarehouseStock", () => ({
  useGetWarehouseStock: () => ({
    data: [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 100 }],
    isSuccess: true,
  }),
}));

vi.mock("./useOrderMaterialFreeformSupport", () => ({
  useOrderMaterialFreeformSupport: () => ({ supported: true, ready: true }),
}));

vi.mock("../industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({
    copy: { materialSourceCustomer: "Customer part" },
  }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => String(n) }),
}));

vi.mock("../inventory/InventoryItemCombobox", () => ({
  default: () => <div data-testid="inventory-combobox" />,
}));

vi.mock("../inventory/AddInventoryItemDialog", () => ({
  AddInventoryItemDialog: () => null,
}));

vi.mock("../inventory/QuickGoodsReceiptDialog", () => ({
  QuickGoodsReceiptDialog: () => null,
}));

vi.mock("./OrderLineWarrantyFields", () => ({
  default: () => null,
}));

vi.mock("./OrderLinePriceField", () => ({
  default: () => null,
}));

const inventoryItems: InventoryItem[] = [
  {
    id: "item-1",
    workspaceId: "ws-1",
    name: "Pad",
    sku: "P1",
    description: "",
    category: "",
    unit: "м",
    quantity: 100,
    minQuantity: 0,
    purchasePrice: 1,
    sellingPrice: 450,
    supplier: "",
    location: "",
    isActive: true,
    stockStatus: "in_stock",
    createdAt: "",
    updatedAt: "",
  },
];

function Harness({ quantity = 1 }: { quantity?: number }) {
  const form = useForm<{ materials: OrderMaterial[] }>({
    defaultValues: {
      materials: [
        {
          inventoryItemId: "item-1",
          itemName: "Pad",
          price: 450,
          quantity,
          supplySource: "catalog",
          warehouseId: "wh-1",
          quantityIssued: 0,
          quantityReturned: 0,
        },
      ],
    },
    mode: "onBlur",
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "materials" });
  const materialErrors = form.formState.errors.materials;
  return (
    <FormProvider {...form}>
      <OrderMaterialLinesEditor
        control={form.control as EditorProps["control"]}
        fields={fields}
        append={append as EditorProps["append"]}
        remove={remove}
        setValue={form.setValue as EditorProps["setValue"]}
        getValues={form.getValues as EditorProps["getValues"]}
        trigger={form.trigger as EditorProps["trigger"]}
        inventoryItems={inventoryItems}
        errors={materialErrors as EditorProps["errors"]}
      />
      <output data-testid="qty-value">{String(form.watch("materials.0.quantity"))}</output>
    </FormProvider>
  );
}

describe("OrderMaterialLinesEditor decimal quantity", () => {
  it("accepts 2.5 and shows the inventory unit", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("м")).toBeInTheDocument();
    const input = screen.getByLabelText("Quantity for Pad");
    await user.clear(input);
    await user.type(input, "2.5");
    await user.tab();
    await waitFor(() => expect(screen.getByTestId("qty-value")).toHaveTextContent("2.5"));
    expect(screen.queryByText("No more than 2 decimal places")).not.toBeInTheDocument();
  });

  it("rejects more than 2 decimals", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Quantity for Pad");
    await user.clear(input);
    await user.type(input, "2.555");
    await user.tab();
    expect(await screen.findByText("No more than 2 decimal places")).toBeInTheDocument();
  });
});
