import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { prepareOrderForCloseOrPayment } from "./requestCloseOrder";
import { clearOrderUnsavedEditsForTests, registerOrderUnsavedEdits } from "./orderUnsavedEdits";

const order: Order = {
  id: "order-1",
  clientId: "c1",
  clientName: "Ada",
  orderNumber: "ORD-1",
  device: "Car",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  materials: [],
  description: "",
  status: "in-progress",
  closedAt: null,
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 18000,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-11-08",
  updatedAt: "2026-11-08",
};

describe("prepareOrderForCloseOrPayment", () => {
  const t = ((key: string) => key) as never;
  const confirm = vi.fn();
  const save = vi.fn();

  beforeEach(() => {
    clearOrderUnsavedEditsForTests();
    confirm.mockReset();
    save.mockReset();
  });

  it("returns the current order when there are no unsaved edits", async () => {
    await expect(prepareOrderForCloseOrPayment({ order, confirm, t })).resolves.toBe(order);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks to save first and opens with the saved total", async () => {
    const saved = { ...order, totalPrice: 25000 };
    save.mockResolvedValue(saved);
    registerOrderUnsavedEdits(order.id, { isDirty: () => true, save });
    confirm.mockResolvedValue(true);

    await expect(prepareOrderForCloseOrPayment({ order, confirm, t })).resolves.toEqual(saved);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "orders.lifecycle.unsavedBeforeCloseTitle",
        confirmLabel: "orders.lifecycle.saveAndContinue",
      }),
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancels without saving when the user declines", async () => {
    registerOrderUnsavedEdits(order.id, { isDirty: () => true, save });
    confirm.mockResolvedValue(false);
    await expect(prepareOrderForCloseOrPayment({ order, confirm, t })).resolves.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
