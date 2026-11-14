import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Order, OrderStatus } from "../../lib/types";
import type { UpdateOrderStatusResult } from "../../services/apiOrders";
import type { LedgerPayment } from "../finance/paymentTypes";
import { useGetPayments } from "../finance/usePayments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import { industryOrderStatusLabel } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { assertMinPaidOrExplain, orderNetPaidForMinPaid } from "./minPaidStatusGuard";
import { isOrderFormallyClosed } from "./orderLifecycle";
import { isOrderPaidLocked, isPaidStatusOptionBlocked } from "./taxInvoice";
import {
  resolveCurrentUnifiedStatus,
  resolveUnifiedStatusSelection,
  unifiedStatusOptions,
  type UnifiedStatusOption,
} from "./unifiedOrderStatus";
import { isEstimateOrder } from "./orderEstimates";
import { useSetEstimateStatus } from "./useEstimateMutations";
import { useMoveOrderOnBoard } from "./useMoveOrderOnBoard";
import { useUpdateOrderStatus } from "./useGetOrders";
import { useClosedOrderActionPermissions } from "./useClosedOrderPermissions";

export type OrderStatusChangeOption = UnifiedStatusOption & {
  disabled: boolean;
  disabledReason: string | null;
};

export type OrderStatusChangeResult =
  /** `order` is omitted when the change is still in flight (legacy path applies it on success). */
  | { ok: true; order?: Order }
  | { ok: false; reason: string };

export type UseOrderStatusChangeOptions = {
  /** Override ledger rows (e.g. after a just-recorded payment). */
  payments?: LedgerPayment[];
  /** When true, skip client-side min-paid (DB still enforces). */
  paymentsLoading?: boolean;
  /** Prefer this net-paid figure when computing min-paid (post-payment). */
  netPaidOverride?: number | null;
  /** Called after a successful board/custom status move. */
  onOrderUpdated?: (order: Order) => void;
  /**
   * Legacy system-status path (no custom definitions). When set, used instead of
   * `useUpdateOrderStatus` so callers like OrderDetailPanel keep their existing callback.
   */
  onLegacyStatusChange?: (status: OrderStatus) => void;
};

function applyStatusPatch(order: Order, result: UpdateOrderStatusResult): Order {
  const leftPaid = order.status === "paid" && result.status !== "paid";
  return {
    ...order,
    status: result.status,
    customStatusId: result.customStatusId,
    customStatus: result.customStatus,
    ...(Object.prototype.hasOwnProperty.call(result, "closedAt") ? { closedAt: result.closedAt ?? null } : {}),
    ...(result.status === "paid"
      ? { isPaid: true, paymentStatus: "paid" as const }
      : leftPaid && result.status !== "closed" && result.status !== "cancelled"
        ? { isPaid: false, paymentStatus: "unpaid" as const }
        : {}),
  };
}

/**
 * Shared order status selector + change rules (detail panel, post-payment step).
 * Reuses paid lock, tax invoice, min-paid, and unified status transition rules.
 */
export function useOrderStatusChange(order: Order | null | undefined, opts: UseOrderStatusChangeOptions = {}) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { workflow } = useIndustryWorkflow();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const estimate = isEstimateOrder(order);
  const { data: orderStatusDefinitions = [] } = useGetStatusDefinitions(estimate ? "estimate" : "order");
  const paymentsQuery = useGetPayments();
  const payments = opts.payments ?? paymentsQuery.payments;
  const paymentsLoading = opts.paymentsLoading ?? paymentsQuery.isLoading;
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const workspaceRole = useActiveWorkspaceRole();
  const isWorkspaceOwner = canManageWorkspace(workspaceRole);
  const closedOrderPerms = useClosedOrderActionPermissions();
  const actsAsOwnerForClosed = closedOrderPerms.actsAsOwnerForClosedOrders;
  const { mutateAsync: moveOnBoard, isPending: isMoving } = useMoveOrderOnBoard();
  const { mutateAsync: updateStatus, isPending: isUpdatingStatus } = useUpdateOrderStatus();
  const { mutateAsync: setEstimateStatusAsync, isPending: isSettingEstimateStatus } = useSetEstimateStatus();

  const taxInvoiceRequired = workspace?.requireTaxInvoiceNumber === true;
  const paidStatusLocked = !estimate && order != null && isOrderPaidLocked(order, isWorkspaceOwner);
  const lifecycleStatusLocked =
    !estimate &&
    order != null &&
    (order.status === "cancelled" ? !actsAsOwnerForClosed : isOrderFormallyClosed(order));
  const paidStatusBlocked =
    !estimate && order != null && isPaidStatusOptionBlocked(order, taxInvoiceRequired) && order.status !== "paid";

  const baseOptions = useMemo(() => {
    if (estimate) {
      return orderStatusDefinitions
        .filter((definition) => definition.isActive)
        .map((definition) => ({
          kind: "definition" as const,
          id: definition.id,
          name: definition.name,
          color: definition.color,
          systemStatus: null as OrderStatus | null,
          semanticAction: definition.semanticAction,
          definition,
        }));
    }
    return unifiedStatusOptions(orderStatusDefinitions, (status) => industryOrderStatusLabel(workflow, status));
  }, [estimate, orderStatusDefinitions, workflow]);

  const current = useMemo(() => {
    if (!order) return null;
    if (estimate) {
      if (order.estimateStatusId) {
        return baseOptions.find((option) => option.id === order.estimateStatusId) ?? null;
      }
      return baseOptions[0] ?? null;
    }
    return resolveCurrentUnifiedStatus(order, baseOptions);
  }, [order, estimate, baseOptions]);

  const netPaid = useMemo(() => {
    if (!order) return 0;
    if (opts.netPaidOverride != null && Number.isFinite(opts.netPaidOverride)) {
      return opts.netPaidOverride;
    }
    return orderNetPaidForMinPaid(order, payments);
  }, [order, opts.netPaidOverride, payments]);

  const options: OrderStatusChangeOption[] = useMemo(() => {
    if (!order) return [];
    if (estimate) {
      return baseOptions.map((option) => ({ ...option, disabled: false, disabledReason: null }));
    }
    const paidLockReason = t("orders.errors.paidStatusLocked");
    const taxReason = t("orders.taxInvoice.requiredHint");
    const cancelledReason = t("orders.lifecycle.errors.orderAlreadyCancelled");
    const closedReason = t("orders.lifecycle.errors.closedOrderImmutable");
    const unavailableReason = t("orders.errors.statusChangeUnavailable");

    return baseOptions.map((option) => {
      if (paidStatusLocked) {
        return {
          ...option,
          disabled: true,
          disabledReason: paidLockReason,
        };
      }

      if (option.systemStatus === "paid" && paidStatusBlocked) {
        return {
          ...option,
          disabled: true,
          disabledReason: taxReason,
        };
      }

      const move = resolveUnifiedStatusSelection(order, option, {
        allowReopenCancelled: actsAsOwnerForClosed,
      });
      if (!move) {
        // Current status is a no-op, not a hard block — leave enabled for display.
        const isCurrent =
          current != null &&
          ((option.kind === "definition" && current.id === option.id) ||
            (option.kind === "system" && current.systemStatus === option.systemStatus && !order.customStatusId));
        if (isCurrent) {
          return { ...option, disabled: false, disabledReason: null };
        }
        // Close options stay selectable so the UI can open the Close order flow (mileage confirm + CloseOrderDialog).
        if (
          !lifecycleStatusLocked &&
          (option.semanticAction === "close" || option.systemStatus === "closed")
        ) {
          return { ...option, disabled: false, disabledReason: null };
        }
        if (lifecycleStatusLocked) {
          return {
            ...option,
            disabled: true,
            disabledReason: order.status === "cancelled" ? cancelledReason : closedReason,
          };
        }
        return {
          ...option,
          disabled: true,
          disabledReason: unavailableReason,
        };
      }

      if (move.status === "paid" && isPaidStatusOptionBlocked(order, taxInvoiceRequired)) {
        return {
          ...option,
          disabled: true,
          disabledReason: taxReason,
        };
      }

      if (!paymentsLoading) {
        const minPaidBlock = assertMinPaidOrExplain({
          order,
          targetDefinition: option.definition,
          netPaid,
          formatMoney,
          t,
        });
        if (minPaidBlock) {
          return {
            ...option,
            disabled: true,
            disabledReason: minPaidBlock.message,
          };
        }
      }

      return { ...option, disabled: false, disabledReason: null };
    });
    // formatMoney/t are read for labels; option identity should follow order/rules, not formatter identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stabilize Select item identity across parent re-renders
  }, [
    order,
    estimate,
    baseOptions,
    paidStatusLocked,
    paidStatusBlocked,
    actsAsOwnerForClosed,
    current,
    lifecycleStatusLocked,
    taxInvoiceRequired,
    paymentsLoading,
    netPaid,
  ]);

  const canChangeStatus =
    Boolean(order) &&
    subscriptionAllowsWrite &&
    !lifecycleStatusLocked &&
    !paidStatusLocked;

  const isPending = isMoving || isUpdatingStatus || isSettingEstimateStatus;

  const onOrderUpdated = opts.onOrderUpdated;
  const onLegacyStatusChange = opts.onLegacyStatusChange;

  const changeTo = useCallback(
    async (optionId: string): Promise<OrderStatusChangeResult> => {
      if (!order) {
        return { ok: false, reason: t("orders.errors.statusChangeUnavailable") };
      }
      if (!subscriptionAllowsWrite) {
        return { ok: false, reason: t("orders.errors.statusChangeUnavailable") };
      }

      if (isEstimateOrder(order)) {
        if (order.estimateStatusId === optionId) return { ok: true, order };
        try {
          const next = await setEstimateStatusAsync({ orderId: order.id, statusId: optionId });
          onOrderUpdated?.(next);
          return { ok: true, order: next };
        } catch (error) {
          const reason =
            error instanceof Error && error.message.trim()
              ? error.message
              : t("orders.toast.statusUpdateFailed");
          return { ok: false, reason };
        }
      }

      if (isOrderPaidLocked(order, isWorkspaceOwner)) {
        return { ok: false, reason: t("orders.errors.paidStatusLocked") };
      }

      const option = options.find((item) => item.id === optionId);
      if (!option) {
        return { ok: false, reason: t("orders.errors.statusChangeUnavailable") };
      }
      if (option.disabled && option.disabledReason) {
        return { ok: false, reason: option.disabledReason };
      }

      const move = resolveUnifiedStatusSelection(order, option, {
        allowReopenCancelled: actsAsOwnerForClosed,
      });
      if (!move) {
        // Same status / no-op — treat as success without a server call.
        return { ok: true, order };
      }

      if (move.status === "paid" && isPaidStatusOptionBlocked(order, taxInvoiceRequired)) {
        return { ok: false, reason: t("orders.taxInvoice.requiredHint") };
      }

      if (!paymentsLoading) {
        const minPaidBlock = assertMinPaidOrExplain({
          order,
          targetDefinition: option.definition,
          netPaid,
          formatMoney,
          t,
        });
        if (minPaidBlock) {
          return { ok: false, reason: minPaidBlock.message };
        }
      }

      try {
        if (option.kind === "definition" || move.customStatusId !== null || order.customStatusId) {
          const result = await moveOnBoard({
            orderId: order.id,
            status: move.status,
            customStatusId: move.customStatusId,
            currentStatus: order.status,
          });
          const next = applyStatusPatch(order, {
            ...result,
            customStatus:
              result.customStatus ??
              (option.kind === "definition" ? { name: option.name, color: option.color } : null),
          });
          onOrderUpdated?.(next);
          return { ok: true, order: next };
        }

        if (onLegacyStatusChange) {
          // Fire-and-forget: the owner applies the status only after the server confirms it
          // (useOrderDetails.changeStatus → onSuccess). Returning an optimistic order here made the
          // detail panel show the new status even when the update was rejected, with no rollback.
          onLegacyStatusChange(move.status);
          return { ok: true };
        }

        const result = await updateStatus({ orderId: order.id, status: move.status });
        const next = applyStatusPatch(order, result);
        onOrderUpdated?.(next);
        return { ok: true, order: next };
      } catch (error) {
        const reason =
          error instanceof Error && error.message.trim()
            ? error.message
            : t("orders.toast.statusUpdateFailed");
        return { ok: false, reason };
      }
    },
    [
      order,
      subscriptionAllowsWrite,
      isWorkspaceOwner,
      options,
      actsAsOwnerForClosed,
      taxInvoiceRequired,
      paymentsLoading,
      netPaid,
      formatMoney,
      t,
      moveOnBoard,
      updateStatus,
      setEstimateStatusAsync,
      onOrderUpdated,
      onLegacyStatusChange,
    ],
  );

  return {
    options,
    current,
    changeTo,
    isPending,
    canChangeStatus,
    paidStatusLocked,
    lifecycleStatusLocked,
    paidStatusBlocked,
    subscriptionAllowsWrite,
  };
}

/** Whether the post-payment status step should appear for this order. */
export function shouldOfferPostPaymentStatusStep(
  order: Pick<Order, "status" | "closedAt"> | null | undefined,
  canChangeStatus: boolean,
) {
  if (!order || !canChangeStatus) return false;
  if (isOrderFormallyClosed(order)) return false;
  if (order.status === "cancelled") return false;
  return true;
}

export type { OrderStatus };
