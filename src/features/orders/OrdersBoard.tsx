import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ErrorState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { EntityStatusBadge, OrderStatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import type { Order } from "../../lib/types";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { useGetOrders } from "./useGetOrders";
import { useMoveOrderOnBoard } from "./useMoveOrderOnBoard";
import { buildOrderBoardColumns, resolveBoardMove, type OrderBoardColumn } from "./orderBoard";
import { isOrderOverdue, matchesDeadlineFilter, type DeadlineFilter } from "./orderVisibility";
import { isPaidStatusChangeForbidden, isTaxInvoiceBlocked } from "./taxInvoice";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import { useOrdersWarrantyIndicators } from "./useOrdersWarrantyIndicators";
import type { OrderWarrantyIndicatorModel } from "./warranty";
import { industryProfile } from "../industries/industryProfile";
import { PaymentFormDialog } from "../finance/PaymentFormDialog";
import type { LedgerPayment } from "../finance/paymentTypes";
import { assertMinPaidOrExplain, orderNetPaidForMinPaid, recordableOrderBalance } from "./minPaidStatusGuard";
import { showMinPaidBlockedToast } from "./showMinPaidBlockedToast";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { orderAssetSecondaryLine } from "./industryOrderFieldHelpers";

type OrdersBoardProps = {
  /** Debounced search text (same box as the table). */
  search: string;
  employeeFilter: string;
  deadlineFilter: DeadlineFilter;
  today: string;
  isWorkspaceOwner: boolean;
  requireTaxInvoiceNumber: boolean;
  formatMoney: (amount: number) => string;
  onOpenOrder: (order: Order) => void;
  /** Ledger payments for the min-paid pre-check before a drop; when omitted only the DB guard applies. */
  payments?: LedgerPayment[];
};

/**
 * Kanban-style orders view (docs §5.1). Read-only columns with click-to-open;
 * native HTML5 drag-and-drop moves a card between columns when the workspace can write.
 */
export function OrdersBoard({
  search,
  employeeFilter,
  deadlineFilter,
  today,
  isWorkspaceOwner,
  requireTaxInvoiceNumber,
  formatMoney,
  onOpenOrder,
  payments,
}: OrdersBoardProps) {
  const { t } = useTranslation();
  const { canWrite } = useWorkspaceSubscription();
  const { orders, isLoading, error, refetch } = useGetOrders(search);
  const { data: definitions = [], isLoading: definitionsLoading } = useGetStatusDefinitions("order");
  const move = useMoveOrderOnBoard();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [recordPaymentOrder, setRecordPaymentOrder] = useState<Order | null>(null);

  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          (employeeFilter === "all" || order.assignedEmployeeId === employeeFilter) &&
          matchesDeadlineFilter(order, deadlineFilter, today),
      ),
    [orders, employeeFilter, deadlineFilter, today],
  );

  const { byOrderId: warrantyByOrderId } = useOrdersWarrantyIndicators(visibleOrders);
  const columns = useMemo(() => buildOrderBoardColumns(visibleOrders, definitions), [visibleOrders, definitions]);
  const draggedOrder = draggedId ? visibleOrders.find((order) => order.id === draggedId) ?? null : null;
  const movingId = move.isPending ? move.variables?.orderId : undefined;

  function canDropOn(column: OrderBoardColumn) {
    return canWrite && !move.isPending && draggedOrder != null && resolveBoardMove(draggedOrder, column) != null;
  }

  function handleDrop(event: DragEvent, column: OrderBoardColumn) {
    event.preventDefault();
    const order = draggedOrder;
    setDraggedId(null);
    setOverKey(null);
    if (!order || !canWrite || move.isPending) return;

    const target = resolveBoardMove(order, column);
    if (!target) return;

    if (isPaidStatusChangeForbidden(order.status, target.status, isWorkspaceOwner)) {
      toast.error(t("orders.errors.paidStatusLocked"), { id: "paid-status-locked" });
      return;
    }
    if (isTaxInvoiceBlocked(order, target.status, requireTaxInvoiceNumber)) {
      toast.error(t("orders.taxInvoice.required"), { id: "tax-invoice-required" });
      onOpenOrder(order);
      return;
    }

    // Min-paid pre-check (skipped when the ledger is not loaded; the DB guard still enforces it).
    if (payments) {
      const minPaidBlock = assertMinPaidOrExplain({
        order,
        targetDefinition: target.customStatusId
          ? definitions.find((definition) => definition.id === target.customStatusId)
          : null,
        netPaid: orderNetPaidForMinPaid(order, payments),
        formatMoney,
        t,
      });
      if (minPaidBlock) {
        showMinPaidBlockedToast({
          block: minPaidBlock,
          recordPaymentLabel: t("orders.minPaid.recordPayment"),
          onRecordPayment: () => setRecordPaymentOrder(order),
        });
        return;
      }
    }

    move.mutate({ orderId: order.id, status: target.status, customStatusId: target.customStatusId, currentStatus: order.status });
  }

  if (error) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <ErrorState title={t("orders.empty.loadFailed")} description={error.message} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || definitionsLoading) {
    return (
      <div className="flex gap-3 overflow-hidden" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="w-72 shrink-0 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{canWrite ? t("orders.board.hint") : t("orders.board.readOnlyHint")}</p>
      <div className="flex snap-x gap-3 overflow-x-auto pb-3" data-testid="orders-board">
        {columns.map((column) => {
          const droppable = canDropOn(column);
          const isOver = overKey === column.key && droppable;
          const columnLabel =
            column.kind === "custom"
              ? column.definition?.name
              : column.kind === "unassigned"
                ? t("orders.board.unassigned")
                : undefined;

          return (
            <section
              key={column.key}
              aria-label={columnLabel ?? column.systemStatus ?? column.key}
              onDragOver={(event) => {
                if (!droppable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (overKey !== column.key) setOverKey(column.key);
              }}
              onDragLeave={() => setOverKey((current) => (current === column.key ? null : current))}
              onDrop={(event) => handleDrop(event, column)}
              className={cn(
                "flex max-h-[calc(100vh-18rem)] min-h-40 w-72 shrink-0 snap-start flex-col rounded-lg border bg-muted/40 transition-colors",
                isOver ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border",
              )}
            >
              <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                <div className="min-w-0">
                  {column.kind === "custom" && column.definition ? (
                    <EntityStatusBadge name={column.definition.name} color={column.definition.color} />
                  ) : column.kind === "system" && column.systemStatus ? (
                    <OrderStatusBadge status={column.systemStatus} />
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">{columnLabel}</span>
                  )}
                  {column.group ? (
                    <p className="mt-1 truncate text-[11px] text-subtle-foreground">{t(`orders.board.groups.${column.group}`)}</p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
                  {column.orders.length}
                </span>
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {column.orders.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("orders.board.emptyColumn")}
                  </p>
                ) : (
                  column.orders.map((order) => (
                    <BoardCard
                      key={order.id}
                      order={order}
                      overdue={isOrderOverdue(order, today)}
                      draggable={canWrite && !move.isPending}
                      isDragging={draggedId === order.id}
                      isMoving={movingId === order.id}
                      warrantyIndicator={warrantyByOrderId.get(order.id)}
                      formatMoney={formatMoney}
                      onOpen={onOpenOrder}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", order.id);
                        setDraggedId(order.id);
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setOverKey(null);
                      }}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
      {recordPaymentOrder && payments ? (
        <PaymentFormDialog
          open
          onOpenChange={(open) => !open && setRecordPaymentOrder(null)}
          target="order"
          orderId={recordPaymentOrder.id}
          balance={recordableOrderBalance(recordPaymentOrder, payments)}
        />
      ) : null}
    </div>
  );
}

type BoardCardProps = {
  order: Order;
  overdue: boolean;
  draggable: boolean;
  isDragging: boolean;
  isMoving: boolean;
  warrantyIndicator?: OrderWarrantyIndicatorModel | null;
  formatMoney: (amount: number) => string;
  onOpen: (order: Order) => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
};

function BoardCard({
  order,
  overdue,
  draggable,
  isDragging,
  isMoving,
  warrantyIndicator,
  formatMoney,
  onOpen,
  onDragStart,
  onDragEnd,
}: BoardCardProps) {
  const { t } = useTranslation();
  const { profile, industrySlug } = useIndustryWorkflow();
  const blocks = profile?.orderFieldBlocks ?? industryProfile(industrySlug).orderFieldBlocks;
  const secondary = orderAssetSecondaryLine(order, blocks);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(order);
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      draggable={draggable}
      aria-busy={isMoving || undefined}
      aria-label={t("orders.board.openOrder", { number: order.orderNumber })}
      onClick={() => onOpen(order)}
      onKeyDown={handleKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "min-w-0 rounded-lg border border-border bg-card p-3 text-left shadow-xs transition-[background-color,box-shadow,opacity] outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/35",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        (isDragging || isMoving) && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-primary tabular-nums">{order.orderNumber || "—"}</span>
          <OrderWarrantyIndicator model={warrantyIndicator} className="mt-0.5" />
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(order.totalPrice)}</span>
      </div>
      <p className="mt-1 truncate text-sm font-medium text-foreground" title={order.clientName}>
        {order.clientName || "—"}
      </p>
      {order.device ? (
        <p className="truncate text-xs text-muted-foreground" title={order.device}>
          {order.device}
        </p>
      ) : null}
      {secondary ? (
        <p className="truncate text-[11px] tabular-nums text-muted-foreground" title={secondary}>
          {secondary}
        </p>
      ) : null}
      <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
        <OrderStatusBadge status={order.status} customStatus={order.customStatus} />
        {order.deadline ? (
          <span className={cn("shrink-0 text-xs tabular-nums", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
            {order.deadline}
          </span>
        ) : null}
      </div>
    </article>
  );
}
