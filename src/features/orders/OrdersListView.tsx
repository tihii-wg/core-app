import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { DataTable, type Column } from "../../ui/DataTable";
import { Skeleton } from "../../ui/Skeleton";
import { useIsMobile } from "../../hooks/use-mobile";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { useCreateInvoice } from "../invoices/useCreateInvoice";
import { useGetPayments } from "../finance/usePayments";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import { localDateKey } from "../../pages/dashboardStats";
import { OrderCard } from "./OrderCard";
import { OrderColumnsMenu } from "./OrderColumnsMenu";
import { buildOrderColumns } from "./buildOrderColumns";
import { EditOrderDialog } from "./EditOrderDialog";
import { useOrdersWarrantyIndicators } from "./useOrdersWarrantyIndicators";
import {
  DEFAULT_DASHBOARD_ORDER_VISIBLE_COLUMNS,
  DEFAULT_ORDER_VISIBLE_COLUMNS,
  DASHBOARD_ORDER_COLUMN_STORAGE_KEY,
  ORDER_COLUMN_STORAGE_KEY,
  readOrderVisibleColumns,
  writeOrderVisibleColumns,
  type OrderToggleableColumn,
} from "./orderColumnVisibility";
import type { useOrderDetails } from "./useOrderDetails";


type OrderDetailsApi = ReturnType<typeof useOrderDetails>;

export type OrdersListViewProps = {
  orders: Order[];
  isLoading: boolean;
  emptyState: ReactNode;
  orderDetails: OrderDetailsApi;
  onEdit?: (order: Order) => void;
  onDeleted?: (orderId: string) => void;
  /** Inserted before the actions column. */
  extraColumns?: Column<Order>[];
  showColumnsMenu?: boolean;
  /** Storage key suffix/id: "orders" (default) or "dashboard". */
  columnVisibilityKey?: "orders" | "dashboard";
  /** Controlled visibility (Orders page toolbar). When set, skips internal storage writes unless onVisibleColumnsChange is also set. */
  visibleColumns?: ReadonlySet<OrderToggleableColumn>;
  onVisibleColumnsChange?: (columns: Set<OrderToggleableColumn>) => void;
  cardExtra?: (order: Order) => ReactNode;
  /** Open client details from the client name cell. */
  onOpenClient?: (clientId: string) => void;
  className?: string;
};

function storageForKey(key: "orders" | "dashboard") {
  if (key === "dashboard") {
    return {
      storageKey: DASHBOARD_ORDER_COLUMN_STORAGE_KEY,
      defaults: DEFAULT_DASHBOARD_ORDER_VISIBLE_COLUMNS,
    };
  }
  return { storageKey: ORDER_COLUMN_STORAGE_KEY, defaults: DEFAULT_ORDER_VISIBLE_COLUMNS };
}

/**
 * Shared Orders / Dashboard list: same desktop columns, mobile OrderCards,
 * actions menu, warranty indicators, team avatars, and column visibility.
 */
export function OrdersListView({
  orders,
  isLoading,
  emptyState,
  orderDetails,
  onEdit,
  onDeleted,
  extraColumns = [],
  showColumnsMenu = false,
  columnVisibilityKey = "orders",
  visibleColumns: visibleColumnsProp,
  onVisibleColumnsChange,
  cardExtra,
  onOpenClient,
  className,
}: OrdersListViewProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { copy } = useIndustryWorkflow();
  const { formatMoney } = useWorkspaceMoney();
  const today = localDateKey(new Date());
  const { invoices, isUnavailable: invoicesUnavailable } = useGetInvoices();
  const { payments } = useGetPayments();
  const createInvoice = useCreateInvoice();
  const { byOrderId: warrantyByOrderId } = useOrdersWarrantyIndicators(orders);

  const { storageKey, defaults } = storageForKey(columnVisibilityKey);
  const [internalVisible, setInternalVisible] = useState(
    () => new Set<OrderToggleableColumn>(readOrderVisibleColumns(storageKey, defaults)),
  );
  const visibleColumns = visibleColumnsProp ?? internalVisible;
  const [internalEditing, setInternalEditing] = useState<Order | null>(null);
  const editingControlled = onEdit != null;
  const setEditingOrder = onEdit ?? setInternalEditing;

  const invoiceNumberByOrder = useMemo(
    () => new Map(invoices.flatMap((invoice) => (invoice.orderId ? [[invoice.orderId, invoice.invoiceNumber] as const] : []))),
    [invoices],
  );

  const paymentStatusByOrder = useMemo(() => {
    const map = new Map<string, ReturnType<typeof orderPaymentBalance>["status"]>();
    for (const order of orders) {
      map.set(order.id, orderPaymentBalance(order, payments).status);
    }
    return map;
  }, [orders, payments]);

  const paymentCountByOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of payments) {
      if (!row.orderId) continue;
      map.set(row.orderId, (map.get(row.orderId) ?? 0) + 1);
    }
    return map;
  }, [payments]);

  function handleCreateInvoice(order: Order) {
    if (createInvoice.isPending) return;
    createInvoice.mutate(order.id);
  }

  function handleDeleted(orderId: string) {
    orderDetails.clearOrder(orderId);
    if (!editingControlled) {
      setInternalEditing((current) => (current?.id === orderId ? null : current));
    }
    onDeleted?.(orderId);
  }

  function openClient(clientId: string) {
    onOpenClient?.(clientId);
  }

  const allColumns = useMemo(() => {
    const base = buildOrderColumns({
      t,
      deviceServiceColumn: copy.deviceServiceColumn,
      formatMoney,
      today,
      warrantyByOrderId,
      paymentStatusByOrder,
      invoiceNumberByOrder,
      paymentCountByOrder,
      invoicesUnavailable,
      isCreatingInvoice: createInvoice.isPending,
      isStatusUpdating: orderDetails.isStatusUpdating,
      requireTaxInvoiceNumber: orderDetails.requireTaxInvoiceNumber,
      onOpenClient: openClient,
      onView: orderDetails.openOrder,
      onEdit: setEditingOrder,
      onStatusChange: orderDetails.changeStatus,
      onCreateInvoice: handleCreateInvoice,
      onOrderUpdated: orderDetails.syncOrder,
      onDeleted: handleDeleted,
      includePaymentColumn: true,
    });
    if (extraColumns.length === 0) return base;
    const actionsIndex = base.findIndex((column) => column.key === "actions");
    if (actionsIndex < 0) return [...base, ...extraColumns];
    return [...base.slice(0, actionsIndex), ...extraColumns, ...base.slice(actionsIndex)];
  }, [
    t,
    copy.deviceServiceColumn,
    formatMoney,
    today,
    warrantyByOrderId,
    paymentStatusByOrder,
    invoiceNumberByOrder,
    paymentCountByOrder,
    invoicesUnavailable,
    createInvoice.isPending,
    orderDetails,
    extraColumns,
    setEditingOrder,
  ]);

  const columns = allColumns.filter(
    (column) =>
      column.key === "orderNumber" ||
      column.key === "actions" ||
      extraColumns.some((extra) => extra.key === column.key) ||
      visibleColumns.has(column.key as OrderToggleableColumn),
  );

  function handleVisibleColumnsChange(next: Set<OrderToggleableColumn>) {
    if (onVisibleColumnsChange) {
      onVisibleColumnsChange(next);
      return;
    }
    setInternalVisible(next);
    writeOrderVisibleColumns(next, storageKey);
  }

  return (
    <div className={className}>
      {showColumnsMenu ? (
        <div className="mb-3 flex justify-end">
          <OrderColumnsMenu
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={handleVisibleColumnsChange}
            deviceColumnLabel={copy.deviceServiceColumn}
          />
        </div>
      ) : null}

      {isMobile ? (
        isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-xs">{emptyState}</div>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div key={order.id}>
                <OrderCard
                  order={order}
                  invoiceNumber={invoiceNumberByOrder.get(order.id)}
                  linkedPaymentCount={paymentCountByOrder.get(order.id) ?? 0}
                  invoicesUnavailable={invoicesUnavailable}
                  isCreatingInvoice={createInvoice.isPending}
                  isStatusUpdating={orderDetails.isStatusUpdating}
                  requireTaxInvoiceNumber={orderDetails.requireTaxInvoiceNumber}
                  paymentStatus={paymentStatusByOrder.get(order.id)}
                  warrantyIndicator={warrantyByOrderId.get(order.id)}
                  formatMoney={formatMoney}
                  onView={orderDetails.openOrder}
                  onOpenClient={onOpenClient}
                  onEdit={setEditingOrder}
                  onStatusChange={orderDetails.changeStatus}
                  onCreateInvoice={handleCreateInvoice}
                  onOrderUpdated={orderDetails.syncOrder}
                  onDeleted={handleDeleted}
                />
                {cardExtra?.(order)}
              </div>
            ))}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          data={orders}
          keyExtractor={(order) => order.id}
          onRowClick={orderDetails.openOrder}
          isLoading={isLoading}
          emptyState={emptyState}
        />
      )}

      {!editingControlled ? (
        <EditOrderDialog
          order={internalEditing}
          onClose={() => setInternalEditing(null)}
          onUpdated={orderDetails.syncOrder}
        />
      ) : null}
    </div>
  );
}
