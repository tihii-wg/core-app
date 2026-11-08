import { roundMoney } from "./paymentCalculations";

export type PaymentStageMode = "percent" | "amount" | "remainder";

/** Persisted / template stage shape (no computed money). */
export type PaymentStageInput = {
  id?: string;
  position: number;
  name: string;
  mode: PaymentStageMode;
  percent?: number | null;
  amount?: number | null;
  dueDate?: string | null;
  /** Template-only: days from order creation (or today) to due date. */
  dueDays?: number | null;
  invoiceId?: string | null;
};

export type PaymentStageTemplateItem = {
  name: string;
  mode: PaymentStageMode;
  percent?: number | null;
  amount?: number | null;
  dueDays?: number | null;
};

export type ResolvedPaymentStage = PaymentStageInput & {
  due: number;
};

export type PaymentStageAllocationState = "paid" | "partial" | "pending" | "overdue";

export type AllocatedPaymentStage = ResolvedPaymentStage & {
  paid: number;
  remaining: number;
  state: PaymentStageAllocationState;
};

export type StageAmountWarning = "over_total" | "sum_mismatch" | null;

function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sortedStages<T extends { position: number }>(stages: readonly T[]): T[] {
  return stages.slice().sort((a, b) => a.position - b.position || 0);
}

/** Resolve due amounts from modes + order total. Remainder = max(0, total − sum(others)). */
export function resolveStageAmounts(
  stages: readonly PaymentStageInput[],
  orderTotal: number,
): { stages: ResolvedPaymentStage[]; warning: StageAmountWarning; fixedSum: number } {
  const total = roundMoney(Math.max(0, Number(orderTotal) || 0));
  const ordered = sortedStages(stages);
  let fixedSum = 0;
  let hasRemainder = false;

  for (const stage of ordered) {
    if (stage.mode === "remainder") {
      hasRemainder = true;
      continue;
    }
    if (stage.mode === "percent") {
      fixedSum = roundMoney(fixedSum + (total * Number(stage.percent ?? 0)) / 100);
    } else {
      fixedSum = roundMoney(fixedSum + Math.max(0, Number(stage.amount ?? 0)));
    }
  }

  const remainderDue = roundMoney(Math.max(0, total - fixedSum));
  const resolved: ResolvedPaymentStage[] = ordered.map((stage) => {
    if (stage.mode === "remainder") return { ...stage, due: remainderDue };
    if (stage.mode === "percent") {
      return { ...stage, due: roundMoney((total * Number(stage.percent ?? 0)) / 100) };
    }
    return { ...stage, due: roundMoney(Math.max(0, Number(stage.amount ?? 0))) };
  });

  let warning: StageAmountWarning = null;
  if (fixedSum - total > 0.005) warning = "over_total";
  else if (stages.length > 0 && !hasRemainder && Math.abs(fixedSum - total) > 0.005 && total > 0) warning = "sum_mismatch";

  return { stages: resolved, warning, fixedSum };
}

/**
 * Waterfall: allocate netPaid across stages in position order.
 * Overpayment piles onto the last stage's paid (remaining stays 0).
 */
export function allocatePaid(
  stages: readonly PaymentStageInput[],
  orderTotal: number,
  netPaid: number,
  opts?: { today?: Date },
): AllocatedPaymentStage[] {
  const { stages: resolved } = resolveStageAmounts(stages, orderTotal);
  let left = roundMoney(Math.max(0, Number(netPaid) || 0));
  const today = todayKey(opts?.today ?? new Date());

  return resolved.map((stage) => {
    const due = roundMoney(stage.due);
    const paid = roundMoney(Math.min(due, left));
    left = roundMoney(left - paid);
    const remaining = roundMoney(Math.max(0, due - paid));
    let state: PaymentStageAllocationState;
    if (remaining <= 0.005 && due > 0.005) state = "paid";
    else if (paid > 0.005) state = "partial";
    else if (stage.dueDate && stage.dueDate < today) state = "overdue";
    else state = "pending";
    // Zero-due stages (empty remainder on unpaid order) count as paid.
    if (due <= 0.005) state = "paid";
    return { ...stage, due, paid, remaining, state };
  }).map((stage, index, all) => {
    // Dump leftover overpayment onto the last stage's paid figure.
    if (index === all.length - 1 && left > 0.005) {
      return { ...stage, paid: roundMoney(stage.paid + left) };
    }
    return stage;
  });
}

/** First stage that is not fully paid — default for payment form / stage invoice. */
export function currentPaymentStage(allocated: readonly AllocatedPaymentStage[]): AllocatedPaymentStage | null {
  return allocated.find((stage) => stage.state !== "paid") ?? null;
}

export function applyTemplateToStages(
  template: readonly PaymentStageTemplateItem[],
  opts?: { fromDate?: Date },
): PaymentStageInput[] {
  const from = opts?.fromDate ?? new Date();
  return template.map((item, index) => {
    let dueDate: string | null = null;
    if (item.dueDays != null && Number.isFinite(Number(item.dueDays))) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + Number(item.dueDays));
      dueDate = todayKey(d);
    }
    return {
      position: index,
      name: item.name,
      mode: item.mode,
      percent: item.mode === "percent" ? Number(item.percent ?? 0) : null,
      amount: item.mode === "amount" ? Number(item.amount ?? 0) : null,
      dueDays: item.dueDays ?? null,
      dueDate,
      invoiceId: null,
    };
  });
}

/** Stages due within the next `withinDays` days, plus overdue unpaid stages. */
export function upcomingAndOverdueStages(
  allocatedByOrder: readonly {
    orderId: string;
    orderNumber: string;
    clientName: string;
    stages: readonly AllocatedPaymentStage[];
  }[],
  opts?: { today?: Date; withinDays?: number },
): Array<{
  orderId: string;
  orderNumber: string;
  clientName: string;
  stage: AllocatedPaymentStage;
}> {
  const today = opts?.today ?? new Date();
  const todayStr = todayKey(today);
  const within = opts?.withinDays ?? 7;
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + within);
  const limitStr = todayKey(limit);
  const rows: Array<{
    orderId: string;
    orderNumber: string;
    clientName: string;
    stage: AllocatedPaymentStage;
  }> = [];

  for (const order of allocatedByOrder) {
    for (const stage of order.stages) {
      if (stage.state === "paid" || stage.remaining <= 0.005) continue;
      if (!stage.dueDate) continue;
      if (stage.dueDate < todayStr || (stage.dueDate >= todayStr && stage.dueDate <= limitStr)) {
        rows.push({
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          clientName: order.clientName,
          stage,
        });
      }
    }
  }

  return rows.sort((a, b) => {
    const byDate = String(a.stage.dueDate).localeCompare(String(b.stage.dueDate));
    if (byDate !== 0) return byDate;
    return a.orderNumber.localeCompare(b.orderNumber);
  });
}

export type MinPaidCheck = {
  ok: boolean;
  statusName: string;
  percent: number;
  required: number;
  paid: number;
};

/** Client-side pre-check mirroring crm_orders_min_paid_status_guard. */
export function checkMinPaidForStatus(opts: {
  statusName: string;
  minPaidPercent: number | null | undefined;
  orderTotal: number;
  netPaid: number;
}): MinPaidCheck | null {
  const percent = opts.minPaidPercent;
  if (percent == null || !Number.isFinite(percent) || percent <= 0) return null;
  const total = roundMoney(Math.max(0, opts.orderTotal));
  if (total <= 0) return null;
  const required = roundMoney((total * percent) / 100);
  const paid = roundMoney(Math.max(0, opts.netPaid));
  return {
    ok: paid + 0.005 >= required,
    statusName: opts.statusName,
    percent,
    required,
    paid,
  };
}

const MIN_PAID_ERROR_RE =
  /order_status:min_paid_required\s+status=(.+?)\s+percent=([0-9.]+)\s+required=([0-9.]+)\s+paid=([0-9.]+)/i;

export function parseMinPaidRequiredError(message: string): MinPaidCheck | null {
  const match = message.match(MIN_PAID_ERROR_RE);
  if (!match) return null;
  return {
    ok: false,
    statusName: match[1]!.trim(),
    percent: Number(match[2]),
    required: Number(match[3]),
    paid: Number(match[4]),
  };
}
