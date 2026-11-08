import i18n from "../../i18n";
import { formatWorkspaceMoney } from "../../lib/workspaceFormat";
import type { Order } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import type { LedgerPayment, PaymentBalance } from "../finance/paymentTypes";
import { checkMinPaidForStatus, parseMinPaidRequiredError, type MinPaidCheck } from "../finance/paymentStages";

/**
 * Translate function accepted by the guard. Typed loosely (`never` args) so both the typed
 * `useTranslation().t` and simple test doubles are assignable.
 */
export type MinPaidTranslate = (key: never, options?: never) => unknown;

export type MinPaidBlock = {
  /** Localized, user-facing explanation. */
  message: string;
  required: number;
  paid: number;
  percent: number;
  statusName: string;
};

function formatPercent(percent: number) {
  return String(Math.round(percent * 100) / 100);
}

/** Builds the localized «status requires N% (amount). Paid X.» message from a check result. */
export function minPaidMessage(
  check: Pick<MinPaidCheck, "statusName" | "percent" | "required" | "paid">,
  formatMoney: (amount: number) => string,
  t: MinPaidTranslate,
): string {
  return String(
    t(
      "orders.minPaid.required" as never,
      {
        status: check.statusName,
        percent: formatPercent(check.percent),
        required: formatMoney(check.required),
        paid: formatMoney(check.paid),
      } as never,
    ),
  );
}

/** Net paid (ledger) for an order — same figure the DB guard compares against. */
export function orderNetPaidForMinPaid(order: Pick<Order, "id" | "totalPrice" | "isPaid" | "status">, payments: LedgerPayment[]) {
  return orderPaymentBalance(order, payments).netPaid;
}

/** Balance to hand to the record-payment form (legacy "paid" orders without ledger rows can record up to total). */
export function recordableOrderBalance(
  order: Pick<Order, "id" | "totalPrice" | "isPaid" | "status">,
  payments: LedgerPayment[],
): PaymentBalance {
  const balance = orderPaymentBalance(order, payments);
  return balance.isLegacyUnreconciled
    ? { ...balance, remaining: balance.total, netPaid: 0, status: "unpaid" }
    : balance;
}

/**
 * Client-side pre-check before moving an order to `targetDefinition`.
 * Returns null when the move is allowed (no requirement or already paid enough),
 * otherwise a block with the localized message.
 */
export function assertMinPaidOrExplain(input: {
  order: Pick<Order, "totalPrice">;
  targetDefinition: Pick<StatusDefinition, "name" | "minPaidPercent"> | null | undefined;
  netPaid: number;
  formatMoney: (amount: number) => string;
  t: MinPaidTranslate;
}): MinPaidBlock | null {
  const { order, targetDefinition, netPaid, formatMoney, t } = input;
  if (!targetDefinition) return null;
  const check = checkMinPaidForStatus({
    statusName: targetDefinition.name,
    minPaidPercent: targetDefinition.minPaidPercent,
    orderTotal: order.totalPrice,
    netPaid,
  });
  if (!check || check.ok) return null;
  return {
    message: minPaidMessage(check, formatMoney, t),
    required: check.required,
    paid: check.paid,
    percent: check.percent,
    statusName: check.statusName,
  };
}

/**
 * Maps the DB trigger error (`order_status:min_paid_required ...`) to the same localized message
 * as the client pre-check. Returns null when the message is not a min-paid error.
 */
export function mapMinPaidStatusError(
  message: string | null | undefined,
  opts?: { currency?: string | null; formatMoney?: (amount: number) => string; t?: MinPaidTranslate },
): string | null {
  if (!message) return null;
  const check = parseMinPaidRequiredError(message);
  if (!check) return null;
  const formatMoney = opts?.formatMoney ?? ((amount: number) => formatWorkspaceMoney(amount, opts?.currency));
  const t: MinPaidTranslate = opts?.t ?? ((key, options) => i18n.t(key as never, options as never));
  return minPaidMessage(check, formatMoney, t);
}
