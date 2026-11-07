import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import type { Order, OrderStatus } from "../../lib/types";
import type { Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import type { OrderWarrantyIndicatorModel } from "./warranty";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderClientName } from "./OrderClientName";
import OrderTeamAvatars from "./OrderTeamAvatars";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import { isOrderOverdue } from "./orderVisibility";
import { orderPaymentBalance } from "../finance/paymentCalculations";

type PaymentBalanceStatus = ReturnType<typeof orderPaymentBalance>["status"];

export type BuildOrderColumnsArgs = {
  t: TFunction;
  deviceServiceColumn: string;
  formatMoney: (value: number) => string;
  today: string;
  warrantyByOrderId: Map<string, OrderWarrantyIndicatorModel | null | undefined>;
  paymentStatusByOrder: Map<string, PaymentBalanceStatus>;
  invoiceNumberByOrder: Map<string, string>;
  paymentCountByOrder: Map<string, number>;
  invoicesUnavailable: boolean;
  isCreatingInvoice: boolean;
  isStatusUpdating: boolean;
  requireTaxInvoiceNumber: boolean;
  onOpenClient: (clientId: string) => void;
  onView: (order: Order) => void;
  onEdit: (order: Order) => void;
  onStatusChange: (order: Order, status: OrderStatus) => void;
  onCreateInvoice: (order: Order) => void;
  onOrderUpdated: (order: Order) => void;
  onDeleted: (orderId: string) => void;
  /** When true, render a standalone payment column (toggleable). */
  includePaymentColumn?: boolean;
};

/** Shared Orders / Dashboard table columns (order # … actions). */
export function buildOrderColumns(args: BuildOrderColumnsArgs): Column<Order>[] {
  const columns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: args.t("orders.table.orderNumber"),
      cell: (order) => (
        <div className="min-w-0">
          <span className="font-medium text-primary tabular-nums">{order.orderNumber}</span>
          <OrderWarrantyIndicator model={args.warrantyByOrderId.get(order.id)} className="mt-0.5" />
        </div>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: args.t("orders.table.client"),
      cell: (order) => {
        const phone = order.clientPhone?.trim() || "—";
        return (
          <div className="max-w-[11rem] min-w-0 2xl:max-w-[13rem]">
            <div className="truncate font-medium">
              <OrderClientName clientId={order.clientId} clientName={order.clientName} onOpenClient={args.onOpenClient} />
            </div>
            <div className="truncate text-xs text-muted-foreground" title={phone}>
              {phone}
            </div>
          </div>
        );
      },
    },
    {
      key: "clientType",
      header: args.t("orders.table.clientType"),
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
    },
    {
      key: "device",
      header: args.deviceServiceColumn,
      cell: (order) => (
        <div className="max-w-[11rem] min-w-0 2xl:max-w-[13rem]">
          <div className="truncate" title={order.device}>
            {order.device}
          </div>
          {order.service ? (
            <div className="truncate text-xs text-muted-foreground" title={order.service}>
              {order.service}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: args.t("common.status"),
      cell: (order) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <OrderStatusBadge status={order.status} customStatus={order.customStatus} />
          <PaymentStatusBadge status={args.paymentStatusByOrder.get(order.id) ?? order.paymentStatus} />
        </div>
      ),
    },
  ];

  if (args.includePaymentColumn) {
    columns.push({
      key: "payment",
      header: args.t("orders.table.payment"),
      cell: (order) => <PaymentStatusBadge status={args.paymentStatusByOrder.get(order.id) ?? order.paymentStatus} />,
    });
  }

  columns.push(
    {
      key: "createdBy",
      header: args.t("orders.table.createdBy"),
      cell: (order) => {
        const creator = order.createdByName?.trim() || args.t("orders.table.unknownCreator");
        return (
          <div className="max-w-[11rem] min-w-0">
            <div className="truncate font-medium" title={creator}>
              {creator}
            </div>
            <div className="tabular-nums text-xs text-muted-foreground">{order.createdAt || "—"}</div>
          </div>
        );
      },
    },
    {
      key: "employee",
      header: args.t("orders.table.assigned"),
      cell: (order) => (
        <span
          className="block max-w-[10rem] truncate text-muted-foreground"
          title={order.assignedEmployeeName || args.t("orders.detail.unassigned")}
        >
          {order.assignedEmployeeName || args.t("orders.detail.unassigned")}
        </span>
      ),
    },
    {
      key: "team",
      header: args.t("orders.table.team"),
      cell: (order) => <OrderTeamAvatars team={order.team ?? []} />,
    },
    {
      key: "deadline",
      header: args.t("orders.table.deadline"),
      cell: (order) => (
        <span
          className={cn(
            "tabular-nums",
            isOrderOverdue(order, args.today) ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {order.deadline || "—"}
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "total",
      header: args.t("common.total"),
      cell: (order) => <span className="font-medium tabular-nums">{args.formatMoney(order.totalPrice)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "actions",
      header: args.t("common.actions"),
      stickyRight: true,
      className: "w-[80px] text-right",
      cell: (order) => (
        <div className="flex justify-end gap-1">
          <OrderActionsMenu
            order={order}
            invoiceNumber={args.invoiceNumberByOrder.get(order.id)}
            linkedPaymentCount={args.paymentCountByOrder.get(order.id) ?? 0}
            invoicesUnavailable={args.invoicesUnavailable}
            isCreatingInvoice={args.isCreatingInvoice}
            isStatusUpdating={args.isStatusUpdating}
            requireTaxInvoiceNumber={args.requireTaxInvoiceNumber}
            onView={args.onView}
            onEdit={args.onEdit}
            onStatusChange={args.onStatusChange}
            onCreateInvoice={args.onCreateInvoice}
            onOrderUpdated={args.onOrderUpdated}
            onDeleted={args.onDeleted}
          />
        </div>
      ),
    },
  );

  return columns;
}

export type OrderCardExtra = (order: Order) => ReactNode;
