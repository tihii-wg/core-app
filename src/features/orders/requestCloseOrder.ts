import type { TFunction } from "i18next";
import type { Order } from "../../lib/types";
import type { ConfirmOptions } from "../../ui/ConfirmProvider";
import { getOrderUnsavedEdits } from "./orderUnsavedEdits";

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

/**
 * If the order has unsaved edits, ask to save first. On confirm, saves and returns the
 * fresh order; on cancel returns null. When clean, returns the current order unchanged.
 */
export async function prepareOrderForCloseOrPayment(opts: {
  order: Order;
  confirm: ConfirmFn;
  t: TFunction;
}): Promise<Order | null> {
  const session = getOrderUnsavedEdits(opts.order.id);
  if (!session?.isDirty()) return opts.order;

  const proceed = await opts.confirm({
    title: opts.t("orders.lifecycle.unsavedBeforeCloseTitle"),
    description: opts.t("orders.lifecycle.unsavedBeforeCloseDescription"),
    confirmLabel: opts.t("orders.lifecycle.saveAndContinue"),
    cancelLabel: opts.t("common.cancel"),
    tone: "default",
    icon: "warning",
  });
  if (!proceed) return null;

  return session.save();
}
