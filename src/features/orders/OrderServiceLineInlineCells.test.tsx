import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { OrderService } from "../../lib/types";
import OrderServiceLineInlineCells, {
  OrderServiceLinePerformerInline,
  type ServiceLineInlineEditTarget,
  type ServiceLineInlineField,
} from "./OrderServiceLineInlineCells";

const line: OrderService = {
  id: "line-1",
  serviceId: "svc-1",
  serviceName: "Oil change",
  price: 40,
  quantity: 1,
  technicianId: null,
};

function renderCells(props: {
  editable?: boolean;
  editing?: ServiceLineInlineEditTarget | null;
  onSaveField?: (field: ServiceLineInlineField, value: string) => Promise<void>;
  onCancel?: () => void;
  onSaved?: () => void;
  onEditorClosed?: () => void;
  onTabFromPrice?: () => void;
  onRequestEdit?: (field: ServiceLineInlineField) => void;
}) {
  const onSaveField = props.onSaveField ?? vi.fn(async () => undefined);
  const onCancel = props.onCancel ?? vi.fn();
  const onSaved = props.onSaved ?? vi.fn();
  const onEditorClosed = props.onEditorClosed ?? vi.fn();
  const onTabFromPrice = props.onTabFromPrice ?? vi.fn();
  const onRequestEdit = props.onRequestEdit ?? vi.fn();

  renderWithQuery(
    <table>
      <tbody>
        <tr>
          <td>
            <OrderServiceLinePerformerInline
              line={line}
              editable={props.editable ?? true}
              editing={props.editing ?? null}
              performerOptions={[{ id: "tech-1", name: "Ada" }]}
              saving={false}
              onRequestEdit={() => onRequestEdit("performer")}
              onCancel={onCancel}
              onSaved={onSaved}
              onSaveField={async (id) => onSaveField("performer", id)}
              onEditorClosed={onEditorClosed}
            />
          </td>
          <OrderServiceLineInlineCells
            line={line}
            editable={props.editable ?? true}
            editing={props.editing ?? null}
            formatMoney={(value) => `MDL ${value.toFixed(2)}`}
            locale="en"
            amountNode={<div>MDL 40.00</div>}
            saving={false}
            onRequestEdit={onRequestEdit}
            onCancel={onCancel}
            onSaved={onSaved}
            onSaveField={onSaveField}
            onTabFromPrice={onTabFromPrice}
            onEditorClosed={onEditorClosed}
          />
        </tr>
      </tbody>
    </table>,
  );

  return { onSaveField, onCancel, onSaved, onEditorClosed, onTabFromPrice, onRequestEdit };
}

describe("OrderServiceLineInlineCells", () => {
  it("opens the price editor on click and saves on Enter", async () => {
    const user = userEvent.setup();
    const onRequestEdit = vi.fn();
    const onSaveField = vi.fn(async () => undefined);
    const { rerender } = renderWithQuery(
      <table>
        <tbody>
          <tr>
            <OrderServiceLineInlineCells
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
              onTabFromPrice={vi.fn()}
              onEditorClosed={vi.fn()}
            />
          </tr>
        </tbody>
      </table>,
    );

    await user.click(screen.getByTestId("service-line-price-line-1"));
    expect(onRequestEdit).toHaveBeenCalledWith("price");

    rerender(
      <table>
        <tbody>
          <tr>
            <OrderServiceLineInlineCells
              line={line}
              editable
              editing={{ lineId: "line-1", field: "price" }}
              formatMoney={(value) => `MDL ${value.toFixed(2)}`}
              locale="en"
              amountNode={<div>MDL 40.00</div>}
              saving={false}
              onRequestEdit={onRequestEdit}
              onCancel={vi.fn()}
              onSaved={vi.fn()}
              onSaveField={onSaveField}
              onTabFromPrice={vi.fn()}
              onEditorClosed={vi.fn()}
            />
          </tr>
        </tbody>
      </table>,
    );

    const input = screen.getByLabelText("Price");
    await user.clear(input);
    await user.type(input, "55,5");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSaveField).toHaveBeenCalledWith("price", "55.5");
    });
  });

  it("cancels on Escape without saving", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSaveField = vi.fn(async () => undefined);
    renderCells({
      editing: { lineId: "line-1", field: "price" },
      onCancel,
      onSaveField,
    });

    await user.click(screen.getByLabelText("Price"));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onSaveField).not.toHaveBeenCalled();
  });

  it("stays read-only when editable is false", () => {
    renderCells({ editable: false });
    expect(screen.queryByTestId("service-line-price-line-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit.*price/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-line-performer-line-1")).not.toBeInTheDocument();
  });

  it("makes quantity click-to-edit", async () => {
    const onRequestEdit = vi.fn();
    renderCells({ editable: true, onRequestEdit });
    const qty = screen.getByTestId("service-line-qty-line-1");
    expect(qty.tagName).toBe("BUTTON");
    expect(qty).toHaveTextContent("1");
    await userEvent.click(qty);
    expect(onRequestEdit).toHaveBeenCalledWith("quantity");
  });

  it("saves a new quantity from the quantity editor", async () => {
    const onSaveField = vi.fn(async () => undefined);
    renderCells({ editable: true, editing: { lineId: "line-1", field: "quantity" }, onSaveField });
    const input = screen.getByTestId("service-line-qty-editor-line-1").querySelector("input")!;
    await userEvent.clear(input);
    await userEvent.type(input, "2,5{Enter}");
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith("quantity", "2.5"));
  });

  it("shows the add-performer placeholder when empty and editable", () => {
    renderCells({ editable: true });
    expect(screen.getByTestId("service-line-performer-line-1")).toHaveTextContent(/Add performer/i);
  });

  it("keeps legacy lines without id read-only", () => {
    renderWithQuery(
      <table>
        <tbody>
          <tr>
            <OrderServiceLineInlineCells
              line={{ ...line, id: undefined }}
              editable
              editing={null}
              formatMoney={(value) => `MDL ${value.toFixed(2)}`}
              locale="en"
              amountNode={<div>MDL 40.00</div>}
              saving={false}
              onRequestEdit={vi.fn()}
              onCancel={vi.fn()}
              onSaved={vi.fn()}
              onSaveField={vi.fn(async () => undefined)}
              onTabFromPrice={vi.fn()}
              onEditorClosed={vi.fn()}
            />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.queryByTestId("service-line-price-line-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit.*price/i })).not.toBeInTheDocument();
  });
});
