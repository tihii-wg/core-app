import type { TFunction } from "i18next";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { OrderTotalBreakdownPopover } from "./OrderTotalBreakdownPopover";
import type { ReactNode } from "react";
import type { Order, OrderStatus } from "../../lib/types";
import type { Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import type { OrderWarrantyIndicatorModel } from "./warranty";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderClientName } from "./OrderClientName";
import OrderTeamAvatars from "./OrderTeamAvatars";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import { isOrderOverdue } from "./orderVisibility";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import type { IndustryOrderFieldBlocks } from "../industries/industryProfile";
import { orderAssetSecondaryLine } from "./industryOrderFieldHelpers";
import {
  ORDER_COLUMN_DEFAULT_WIDTHS,
  ORDER_COLUMN_MIN_WIDTHS,
} from "./orderColumnLayout";

type PaymentBalanceStatus = ReturnType<typeof orderPaymentBalance>["status"];

function colSize(key: keyof typeof ORDER_COLUMN_DEFAULT_WIDTHS) {
  return {
    defaultWidth: ORDER_COLUMN_DEFAULT_WIDTHS[key],
    minWidth: ORDER_COLUMN_MIN_WIDTHS[key],
  };
}

export type BuildOrderColumnsArgs = {
  t: TFunction;
  deviceServiceColumn: string;
  /** Industry field blocks — drives the secondary asset line (plate / serial / site). */
  orderFieldBlocks?: IndustryOrderFieldBlocks;
  /** Overridden column headers from order field config (optional). */
  columnLabels?: Partial<{
    client: string;
    status: string;
    employee: string;
    team: string;
    deadline: string;
    total: string;
  }>;
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
};

/** Shared Orders / Dashboard table columns (order # … actions). */
export function buildOrderColumns(args: BuildOrderColumnsArgs): Column<Order>[] {
  const columns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: args.t("orders.table.orderNumber"),
      ...colSize("orderNumber"),
      cell: (order) => (
        <div className="min-w-0">
          <span className="font-medium text-primary tabular-nums" title={order.orderNumber}>
            {order.orderNumber}
          </span>
          <OrderWarrantyIndicator model={args.warrantyByOrderId.get(order.id)} className="mt-0.5" />
        </div>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: args.columnLabels?.client ?? args.t("orders.table.client"),
      ...colSize("client"),
      flexible: true,
      cell: (order) => {
        const phone = order.clientPhone?.trim() || "—";
        return (
          <div className="min-w-0">
            <div className="truncate font-medium" title={order.clientName}>
              <OrderClientName clientId={order.clientId} clientName={order.clientName} onOpenClient={args.onOpenClient} />
            </div>
            <div className="truncate text-xs text-muted-foreground" title={phone}>
              {phone}
            </div>
            {/* Client type lives under the name/phone (the separate «Тип клиента» column was removed). */}
            {order.clientType ? (
              <div className="mt-1" data-testid="order-client-type">
                <ClientTypeBadge clientType={order.clientType} />
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "device",
      header: args.deviceServiceColumn,
      ...colSize("device"),
      cell: (order) => {
        const secondary = args.orderFieldBlocks ? orderAssetSecondaryLine(order, args.orderFieldBlocks) : "";
        return (
          <div className="min-w-0">
            <div className="truncate" title={order.device}>
              {order.device}
            </div>
            {secondary ? (
              <div className="truncate text-xs tabular-nums text-muted-foreground" title={secondary}>
                {secondary}
              </div>
            ) : null}
            {order.service ? (
              <div className="truncate text-xs text-muted-foreground" title={order.service}>
                {order.service}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "status",
      header: args.columnLabels?.status ?? args.t("orders.table.statusPayment"),
      ...colSize("status"),
      cell: (order) => (
        <div className="flex min-w-0 flex-col flex-wrap items-start gap-1">
          <OrderStatusBadge status={order.status} customStatus={order.customStatus} />
          <PaymentStatusBadge status={args.paymentStatusByOrder.get(order.id) ?? order.paymentStatus} />
        </div>
      ),
    },
  ];

  columns.push(
    {
      key: "createdBy",
      header: args.t("orders.table.createdBy"),
      ...colSize("createdBy"),
      cell: (order) => {
        const creator = order.createdByName?.trim() || args.t("orders.table.unknownCreator");
        return (
          <div className="min-w-0">
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
      header: args.columnLabels?.employee ?? args.t("orders.table.assigned"),
      ...colSize("employee"),
      cell: (order) => (
        <span
          className="block truncate text-muted-foreground"
          title={order.assignedEmployeeName || args.t("orders.detail.unassigned")}
        >
          {order.assignedEmployeeName || args.t("orders.detail.unassigned")}
        </span>
      ),
    },
    {
      key: "team",
      header: args.columnLabels?.team ?? args.t("orders.table.team"),
      ...colSize("team"),
      cell: (order) => <OrderTeamAvatars team={order.team ?? []} />,
    },
    {
      key: "deadline",
      header: args.columnLabels?.deadline ?? args.t("orders.table.deadline"),
      ...colSize("deadline"),
      cell: (order) => (
        <span
          className={cn(
            "tabular-nums",
            isOrderOverdue(order, args.today) ? "font-medium text-destructive" : "text-muted-foreground",
          )}
          title={order.deadline || undefined}
        >
          {order.deadline || "—"}
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "total",
      header: args.columnLabels?.total ?? args.t("common.total"),
      ...colSize("total"),
      cell: (order) => (
        <OrderTotalBreakdownPopover order={order} formatMoney={args.formatMoney}>
          <span className="font-medium tabular-nums" title={args.formatMoney(order.totalPrice)}>
            {args.formatMoney(order.totalPrice)}
          </span>
        </OrderTotalBreakdownPopover>
      ),
      className: "text-left whitespace-nowrap",
    },
    {
      key: "actions",
      header: args.t("common.actions"),
      ...colSize("actions"),
      stickyRight: true,
      resizable: false,
      reorderable: false,
      className: "text-right",
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
