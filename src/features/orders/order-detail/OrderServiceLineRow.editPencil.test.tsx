import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "../../../i18n";
import type { Order, OrderService } from "../../../lib/types";
import { OrderServiceLineRow } from "./OrderServiceLineRow";

const line: OrderService = {
  id: "line-1",
  serviceId: "svc-1",
  serviceName: "Oil change",
  price: 40,
  quantity: 1,
};

const order = {
  id: "order-1",
  status: "in_progress",
  closedAt: null,
  services: [line],
  materials: [],
} as unknown as Order;

const baseProps = {
  line,
  order,
  isHighlighted: false,
  isEditingPrice: false,
  isEditingQty: false,
  isEditingPerformer: false,
  showFieldEdit: true,
  canDelete: true,
  canOpenServiceForm: false,
  showWarrantyKm: true,
  formatMoney: (n: number) => `$${n}`,
  locale: "en",
  detailVatRate: null,
  performerOptions: [],
  saving: false,
  deletePending: false,
  commentsVisible: false,
  commentsEditable: false,
  onSaveComment: vi.fn(),
  onOpenCatalog: vi.fn(),
  onRequestEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onSavedEdit: vi.fn(),
  onSaveField: vi.fn(),
  onDelete: vi.fn(),
  onEditLine: vi.fn(),
  onEditorClosed: vi.fn(),
};

function renderRow(overrides: Partial<typeof baseProps> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <table>
        <tbody>
          <OrderServiceLineRow {...baseProps} {...overrides} />
        </tbody>
      </table>
    </I18nextProvider>,
  );
}

describe("OrderServiceLineRow edit pencil", () => {
  it("shows the pencil when the line is editable and opens the dialog by line id", async () => {
    const user = userEvent.setup();
    const onEditLine = vi.fn();
    renderRow({ onEditLine });
    const pencil = screen.getByTestId("service-line-edit-line-1");
    expect(pencil).toHaveAttribute("aria-label", expect.stringMatching(/edit|изменить|modific/i));
    await user.click(pencil);
    expect(onEditLine).toHaveBeenCalledWith("line-1");
  });

  it("hides the pencil when the order content is locked (showFieldEdit false)", () => {
    renderRow({
      showFieldEdit: false,
      order: { ...order, status: "closed", closedAt: "2026-11-01" } as Order,
    });
    expect(screen.queryByTestId("service-line-edit-line-1")).not.toBeInTheDocument();
  });
});
