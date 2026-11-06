import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoodsReceiptRecord } from "../../services/apiWarehouseOps";
import { renderWithQuery } from "../../tests/renderQuery";
import { maxReturnableQty, SupplierReturnDialog } from "./SupplierReturnDialog";

const mutate = vi.hoisted(() => vi.fn());
const returnedMap = vi.hoisted(() => new Map<string, number>([["i1", 1]]));
const canIncome = vi.hoisted(() => ({ value: true }));

vi.mock("./useWarehouseOps", () => ({
  useCreateAndPostSupplierReturn: () => ({ mutate, isPending: false }),
  useReturnedQuantitiesForReceipt: () => ({ data: returnedMap, isLoading: false }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
  }),
}));

vi.mock("../roles/useMyPermissions", () => ({
  useMyPermissions: () => ({
    can: (key: string) => (key === "finance.transactions.income" ? canIncome.value : true),
  }),
}));

vi.mock("../finance/useFinanceAccounts", () => ({
  useFinanceAccounts: () => ({
    data: [
      {
        id: "acc-1",
        name: "Cash",
        isActive: true,
        currencyCode: "MDL",
      },
      {
        id: "acc-eur",
        name: "EUR till",
        isActive: true,
        currencyCode: "EUR",
      },
    ],
    isLoading: false,
  }),
}));

const receipt: GoodsReceiptRecord = {
  id: "r1",
  workspaceId: "ws-1",
  kind: "receipt",
  warehouseId: "wh-1",
  number: "GR-1",
  comment: "",
  total: 50,
  createdAt: "2026-11-05T00:00:00Z",
  receivedAt: "2026-11-05T00:00:00Z",
  status: "posted",
  posted: true,
  supplierName: "Acme",
  lines: [
    {
      id: "l1",
      inventoryItemId: "i1",
      itemName: "Oil filter",
      itemSku: "OF-1",
      quantity: 5,
      unitCost: 10,
      amount: 50,
    },
  ],
};

async function fillValidReturn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Return reason/i), "Damaged seals");
  const qty = screen.getByLabelText(/Return qty/i);
  await user.clear(qty);
  await user.type(qty, "2");
}

describe("SupplierReturnDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
    canIncome.value = true;
  });

  it("computes max returnable as received minus already returned", () => {
    expect(maxReturnableQty(5, 1)).toBe(4);
    expect(maxReturnableQty(2, 5)).toBe(0);
  });

  it("requires reason and at least one positive line, and caps qty to max returnable", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={vi.fn()} />,
    );

    expect(screen.getByText("Oil filter")).toBeInTheDocument();
    expect(screen.getByText("OF-1")).toBeInTheDocument();
    expect(screen.getByText(/Can return:\s*4/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Post return" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/reason/i);
    expect(mutate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Return reason/i), "Damaged seals");
    await user.click(screen.getByRole("button", { name: "Post return" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one/i);

    const qty = screen.getByLabelText(/Return qty/i);
    await user.clear(qty);
    await user.type(qty, "5");
    await user.click(screen.getByRole("button", { name: "Post return" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 4/i);

    await user.clear(qty);
    await user.type(qty, "2");
    await user.click(screen.getByRole("button", { name: "Post return" }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({
      warehouseId: "wh-1",
      goodsReceiptId: "r1",
      supplierName: "Acme",
      reason: "Damaged seals",
      lines: [{ inventoryItemId: "i1", quantity: 2 }],
      refund: null,
    });
  });

  it("posts with refund when money-back checkbox is enabled", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={vi.fn()} />,
    );

    expect(screen.getByText("Money from supplier")).toBeInTheDocument();
    await fillValidReturn(user);
    await user.click(screen.getByRole("checkbox", { name: /Supplier refunded the money/i }));
    expect(screen.getByLabelText(/^Amount$/i)).toHaveValue("20");

    await user.click(screen.getByRole("button", { name: "Post return" }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({
      refund: { accountId: "acc-1", amount: 20, comment: null },
    });
  });

  it("hides money-back section without finance income permission", () => {
    canIncome.value = false;
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={vi.fn()} />,
    );
    expect(screen.queryByText("Money from supplier")).not.toBeInTheDocument();
  });
});

describe("standalone FIFO supplier return validation", () => {
  it("treats supplierReturn like writeOff for stock checks", async () => {
    const { validateOpLines } = await import("./warehouseOps");
    const available = new Map([["item-1", 3]]);
    expect(
      validateOpLines(
        "supplierReturn",
        [{ inventoryItemId: "item-1", itemName: "Pad", quantity: 4, unitCost: 1 }],
        available,
      ),
    ).toEqual({
      code: "insufficientStock",
      index: 0,
      inventoryItemId: "item-1",
      available: 3,
      requested: 4,
    });
  });
});
