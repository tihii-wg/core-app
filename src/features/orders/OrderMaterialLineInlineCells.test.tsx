import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { OrderMaterial } from "../../lib/types";
import OrderMaterialLineInlineCells, { type MaterialLineInlineEditTarget } from "./OrderMaterialLineInlineCells";
import { InsufficientMaterialStockError } from "./updateOrderMaterialLine";

const line: OrderMaterial = {
  id: "mat-1",
  itemName: "Brake pad",
  price: 20,
  quantity: 2,
  quantityIssued: 2,
  quantityReturned: 0,
  supplySource: "catalog",
  inventoryItemId: "item-1",
  warehouseId: "wh-1",
};

function renderCells(props: {
  editable?: boolean;
  editing?: MaterialLineInlineEditTarget | null;
  purchasePrice?: number;
  onSaveField?: (field: "quantity" | "price", value: string) => Promise<void>;
}) {
  const onSaveField = props.onSaveField ?? vi.fn(async () => undefined);
  const onCancel = vi.fn();
  const onSaved = vi.fn();
  const onEditorClosed = vi.fn();
  const onRequestEdit = vi.fn();

  renderWithQuery(
    <table>
      <tbody>
        <tr>
          <OrderMaterialLineInlineCells
            line={line}
            editable={props.editable ?? true}
            editing={props.editing ?? null}
            formatMoney={(value) => `MDL ${value.toFixed(2)}`}
            locale="en"
            amountNode={<div>MDL 40.00</div>}
            saving={false}
            purchasePrice={props.purchasePrice}
            warehouseName="Main"
            onRequestEdit={onRequestEdit}
            onCancel={onCancel}
            onSaved={onSaved}
            onSaveField={onSaveField}
            onEditorClosed={onEditorClosed}
          />
        </tr>
      </tbody>
    </table>,
  );

  return { onSaveField, onCancel, onSaved, onEditorClosed, onRequestEdit };
}

describe("OrderMaterialLineInlineCells", () => {
  it("opens the quantity editor and saves on Enter", async () => {
    const user = userEvent.setup();
    const onRequestEdit = vi.fn();
    const onSaveField = vi.fn(async () => undefined);
    const { rerender } = renderWithQuery(
      <table>
        <tbody>
          <tr>
            <OrderMaterialLineInlineCells
              line={line}
              editable
              editing={null}
              formatMoney={(value) => `MDL ${value.toFixed(2)}`}
              locale="en"
              amountNode={<div>MDL 40.00</div>}
              saving={false}
              onRequestEdit={onRequestEdit}
              onCancel={vi.fn()}
              onSaved={vi.fn()}
              onSaveField={onSaveField}
              onEditorClosed={vi.fn()}
            />
          </tr>
        </tbody>
      </table>,
    );

    await user.click(screen.getByTestId("material-line-qty-mat-1"));
    expect(onRequestEdit).toHaveBeenCalledWith("quantity");

    rerender(
      <table>
        <tbody>
          <tr>
            <OrderMaterialLineInlineCells
              line={line}
              editable
              editing={{ lineId: "mat-1", field: "quantity" }}
              formatMoney={(value) => `MDL ${value.toFixed(2)}`}
              locale="en"
              amountNode={<div>MDL 40.00</div>}
              saving={false}
              onRequestEdit={onRequestEdit}
              onCancel={vi.fn()}
              onSaved={vi.fn()}
              onSaveField={onSaveField}
              onEditorClosed={vi.fn()}
            />
          </tr>
        </tbody>
      </table>,
    );

    const input = screen.getByLabelText("Qty");
    await user.clear(input);
    await user.type(input, "3,5");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith("quantity", "3.5"));
  });

  it("cancels on Escape without saving", async () => {
    const user = userEvent.setup();
    const { onCancel, onSaveField } = renderCells({
      editing: { lineId: "mat-1", field: "price" },
    });
    await user.click(screen.getByLabelText("Price"));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onSaveField).not.toHaveBeenCalled();
  });

  it("is read-only when editable is false", () => {
    renderCells({ editable: false });
    expect(screen.queryByTestId("material-line-qty-mat-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("material-line-price-mat-1")).not.toBeInTheDocument();
  });

  it("shows the below-cost warning for catalog prices under purchase", () => {
    renderCells({ editable: true, purchasePrice: 25 });
    expect(screen.getByTestId("material-price-below-cost")).toBeInTheDocument();
  });

  it("shows insufficient-stock actions when save rejects with stock error", async () => {
    const user = userEvent.setup();
    const onSaveField = vi.fn(async () => {
      throw new InsufficientMaterialStockError(
        {
          warehouseId: "wh-1",
          warehouseName: "Main",
          available: 1,
          needed: 3,
          materialName: "Brake pad",
          maxQuantity: 3,
        },
        "Only 3 available on warehouse «Main»",
      );
    });
    renderWithQuery(
      <table>
        <tbody>
          <tr>
            <OrderMaterialLineInlineCells
              line={line}
              editable
              editing={{ lineId: "mat-1", field: "quantity" }}
              formatMoney={(value) => `MDL ${value.toFixed(2)}`}
              locale="en"
              amountNode={<div>MDL 40.00</div>}
              saving={false}
              warehouseName="Main"
              warehouseOnHand={1}
              // High client max so the server error path is exercised (race after preflight).
              maxQuantity={100}
              onRequestEdit={vi.fn()}
              onCancel={vi.fn()}
              onSaved={vi.fn()}
              onSaveField={onSaveField}
              onEditorClosed={vi.fn()}
              onSetQuantityToMax={vi.fn()}
            />
          </tr>
        </tbody>
      </table>,
    );
    const input = screen.getByLabelText("Qty");
    await user.clear(input);
    await user.type(input, "5");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("material-line-stock-warning")).toBeInTheDocument());
    expect(screen.getByTestId("material-line-set-max-stock")).toBeInTheDocument();
    expect(screen.getByTestId("material-line-receive-link")).toBeInTheDocument();
  });

  it("blocks typing above maxQuantity and offers set-to-max", async () => {
    const user = userEvent.setup();
    const onSaveField = vi.fn(async () => undefined);
    renderWithQuery(
      <table>
        <tbody>
          <tr>
            <OrderMaterialLineInlineCells
              line={line}
              editable
              editing={{ lineId: "mat-1", field: "quantity" }}
              formatMoney={(value) => `MDL ${value.toFixed(2)}`}
              locale="en"
              amountNode={<div>MDL 40.00</div>}
              saving={false}
              warehouseName="Main"
              warehouseOnHand={1}
              maxQuantity={3}
              onRequestEdit={vi.fn()}
              onCancel={vi.fn()}
              onSaved={vi.fn()}
              onSaveField={onSaveField}
              onEditorClosed={vi.fn()}
              onSetQuantityToMax={vi.fn()}
            />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("material-line-available-hint")).toBeInTheDocument();
    const input = screen.getByLabelText("Qty");
    await user.clear(input);
    await user.type(input, "9");
    await user.keyboard("{Enter}");
    expect(onSaveField).not.toHaveBeenCalled();
    expect(screen.getByTestId("material-line-stock-warning")).toBeInTheDocument();
    expect(screen.getByTestId("material-line-set-max-stock")).toBeInTheDocument();
  });
});
