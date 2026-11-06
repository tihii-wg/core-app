import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierReturnRecord } from "../../services/apiWarehouseOps";
import { renderWithQuery } from "../../tests/renderQuery";
import { SupplierReturnRefundBadge, SupplierReturnRefundDialog } from "./SupplierReturnRefundDialog";

const mutate = vi.hoisted(() => vi.fn());

vi.mock("./useWarehouseOps", () => ({
  useRecordSupplierReturnRefund: () => ({ mutate, isPending: false }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
  }),
}));

vi.mock("../roles/useMyPermissions", () => ({
  useMyPermissions: () => ({
    can: () => true,
  }),
}));

vi.mock("../finance/useFinanceAccounts", () => ({
  useFinanceAccounts: () => ({
    data: [{ id: "acc-1", name: "Cash desk", isActive: true, currencyCode: "MDL" }],
    isLoading: false,
  }),
}));

const returnDoc: SupplierReturnRecord = {
  id: "sr1",
  workspaceId: "ws-1",
  kind: "supplierReturn",
  warehouseId: "wh-1",
  goodsReceiptId: "r1",
  number: "SR-1",
  comment: "",
  total: 40,
  createdAt: "2026-11-06T10:00:00Z",
  postedAt: "2026-11-06T10:00:00Z",
  posted: true,
  supplierName: "Acme",
  reason: "Defect",
  refundAccountId: null,
  financeTransactionId: null,
  lines: [],
};

describe("SupplierReturnRefundDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  it("validates amount ≤ return total and calls record mutation", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <SupplierReturnRefundDialog open onOpenChange={vi.fn()} returnDoc={returnDoc} />,
    );

    const amount = screen.getByLabelText(/^Amount$/i);
    expect(amount).toHaveValue("40");

    await user.clear(amount);
    await user.type(amount, "50");
    await user.click(screen.getByRole("button", { name: /Record money back/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot exceed|MDL 40/i);
    expect(mutate).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, "25");
    await user.click(screen.getByRole("button", { name: /Record money back/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({
      returnId: "sr1",
      input: { accountId: "acc-1", amount: 25, comment: null },
    });
  });
});

describe("SupplierReturnRefundBadge", () => {
  it("shows refunded amount and account", () => {
    renderWithQuery(<SupplierReturnRefundBadge amount={40} accountName="Cash desk" />);
    expect(screen.getByText(/Refunded MDL 40\.00 → Cash desk/i)).toBeInTheDocument();
  });
});
