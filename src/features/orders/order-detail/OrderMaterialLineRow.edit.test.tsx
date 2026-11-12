import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../../i18n";
import type { Order, OrderMaterial } from "../../../lib/types";
import { OrderMaterialLineRow } from "./OrderMaterialLineRow";

vi.mock("../../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => String(n) }),
}));

const catalogLine: OrderMaterial = {
  id: "mat-1",
  inventoryItemId: "item-1",
  itemName: "Brake pad",
  price: 40,
  quantity: 1,
  quantityIssued: 1,
  quantityReturned: 0,
  warehouseId: "wh-1",
  supplySource: "catalog",
};

const freeformLine: OrderMaterial = {
  id: "mat-2",
  itemName: "One-off gasket",
  price: 5,
  quantity: 1,
  supplySource: "one_time",
};

const order = {
  id: "order-1",
  status: "in_progress",
  closedAt: null,
  materials: [catalogLine, freeformLine],
  services: [],
  vehicleMileageUnitSnapshot: "km",
} as unknown as Order;

const baseProps = {
  order,
  isEditingPrice: false,
  isEditingQty: false,
  showWarrantyKm: false,
  formatMoney: (n: number) => String(n),
  locale: "en",
  detailVatRate: null as number | null,
  materialSourceCustomer: "Customer",
  warehouseStock: [] as never[],
  saving: false,
  deletePending: false,
  onOpenCatalog: vi.fn(),
  onRequestEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onSavedEdit: vi.fn(),
  onSaveField: vi.fn(async () => undefined),
  onDelete: vi.fn(),
  onEditLine: vi.fn(),
  onEditorClosed: vi.fn(),
};

describe("OrderMaterialLineRow edit pencil", () => {
  it("shows the pencil for catalog lines when showFieldEdit and canWarehouse", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <table>
          <tbody>
            <OrderMaterialLineRow
              {...baseProps}
              line={catalogLine}
              showFieldEdit
              canWarehouse
            />
          </tbody>
        </table>
      </I18nextProvider>,
    );
    expect(screen.getByTestId("material-line-edit-mat-1")).toBeInTheDocument();
  });

  it("hides the pencil for catalog lines without warehouse rights", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <table>
          <tbody>
            <OrderMaterialLineRow
              {...baseProps}
              line={catalogLine}
              showFieldEdit
              canWarehouse={false}
            />
          </tbody>
        </table>
      </I18nextProvider>,
    );
    expect(screen.queryByTestId("material-line-edit-mat-1")).not.toBeInTheDocument();
  });

  it("shows the pencil for freeform lines without warehouse rights", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <table>
          <tbody>
            <OrderMaterialLineRow
              {...baseProps}
              line={freeformLine}
              showFieldEdit
              canWarehouse={false}
            />
          </tbody>
        </table>
      </I18nextProvider>,
    );
    expect(screen.getByTestId("material-line-edit-mat-2")).toBeInTheDocument();
  });

  it("hides the pencil when showFieldEdit is false (closed / read-only)", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <table>
          <tbody>
            <OrderMaterialLineRow
              {...baseProps}
              line={catalogLine}
              showFieldEdit={false}
              canWarehouse
            />
          </tbody>
        </table>
      </I18nextProvider>,
    );
    expect(screen.queryByTestId("material-line-edit-mat-1")).not.toBeInTheDocument();
  });
});
