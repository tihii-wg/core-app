import type { Order } from "../../lib/types";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import {
  allocatePaid,
  upcomingAndOverdueStages,
  type AllocatedPaymentStage,
  type PaymentStageInput,
} from "../finance/paymentStages";
import type { LedgerPayment } from "../finance/paymentTypes";

export type UpcomingPaymentStageRow = {
  orderId: string;
  orderNumber: string;
  clientName: string;
  stage: AllocatedPaymentStage;
  /** Due date is before `today` (stage still has a remaining amount). */
  overdue: boolean;
};

type StageOrder = Pick<Order, "id" | "orderNumber" | "clientName" | "totalPrice" | "isPaid" | "status">;
type StageWithOrder = PaymentStageInput & { orderId: string };

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Dashboard rows for the "upcoming payments by schedule" card: unpaid stages that are
 * overdue or due within `withinDays` days (default 7), sorted by due date.
 *
 * Net paid per order comes from the ledger (`orderPaymentBalance`); cancelled orders and
 * legacy paid orders without ledger rows are skipped.
 */
export function listUpcomingPaymentStages(opts: {
  orders: readonly StageOrder[];
  stages: readonly StageWithOrder[];
  payments: LedgerPayment[];
  today?: Date;
  withinDays?: number;
}): UpcomingPaymentStageRow[] {
  const today = opts.today ?? new Date();
  const todayStr = dateKey(today);

  const stagesByOrder = new Map<string, StageWithOrder[]>();
  for (const stage of opts.stages) {
    const list = stagesByOrder.get(stage.orderId);
    if (list) list.push(stage);
    else stagesByOrder.set(stage.orderId, [stage]);
  }

  const allocatedByOrder: Array<{
    orderId: string;
    orderNumber: string;
    clientName: string;
    stages: AllocatedPaymentStage[];
  }> = [];

  for (const order of opts.orders) {
    const orderStages = stagesByOrder.get(order.id);
    if (!orderStages || orderStages.length === 0) continue;
    if (order.status === "cancelled") continue;
    const balance = orderPaymentBalance(order, opts.payments);
    if (balance.isLegacyUnreconciled) continue;
    allocatedByOrder.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      clientName: order.clientName,
      stages: allocatePaid(orderStages, order.totalPrice, balance.netPaid, { today }),
    });
  }

  return upcomingAndOverdueStages(allocatedByOrder, { today, withinDays: opts.withinDays }).map((row) => ({
    ...row,
    overdue: Boolean(row.stage.dueDate && row.stage.dueDate < todayStr),
  }));
}
