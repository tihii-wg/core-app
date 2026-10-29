import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Banknote, Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { ListPagination } from "../../ui/ListPagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { EmptyState, ErrorState, NoOrders } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { useOrdersAwaitingPayment, useOrdersPage } from "./useGetOrders";
import { statIconVariants } from "../../ui/statCardStyles";
import type { Order, OrderStatus } from "../../lib/types";
import { useDebounce } from "../../hooks/useDebounce";
import {
  DEFAULT_ORDERS_PAGE_SIZE,
  ORDERS_PAGE_SIZES,
  type OrdersPageSize,
} from "../../services/apiOrders";
import { industryOrderStatusLabel, ORDER_STATUSES } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useOrderDetails } from "./useOrderDetails";
import { CreateOrderDialog } from "./CreateOrderDialog";
import { EditOrderDialog } from "./EditOrderDialog";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import OrderDetailPanel from "./OrderDetailPanel";
import useGetEmployees from "../employees/useGetEmployees";
import { assignableTechnicians } from "./assignableTechnicians";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { useCreateInvoice } from "../invoices/useCreateInvoice";
import { useIsMobile } from "../../hooks/use-mobile";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderCard } from "./OrderCard";
import { OrderColumnsMenu } from "./OrderColumnsMenu";
import {
  readOrderVisibleColumns,
  writeOrderVisibleColumns,
  type OrderToggleableColumn,
} from "./orderColumnVisibility";
import { localDateKey } from "../../pages/dashboardStats";
import { cn } from "../../lib/utils";
import { isOrderOverdue, type DeadlineFilter } from "./orderVisibility";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { useGetPayments } from "../finance/usePayments";
import { orderHasOutstandingBalance, orderPaymentBalance } from "../finance/paymentCalculations";

const orderStatuses: OrderStatus[] = ORDER_STATUSES;

export function Orders() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { workflow, copy } = useIndustryWorkflow();
  const { formatMoney } = useWorkspaceMoney();
  const orderDetails = useOrderDetails();
  const today = localDateKey(new Date());

  // Filters / pagination (server-side via getOrdersPage)
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  /** Toggle: when true, list only orders with ledger remaining > 0. */
  const [awaitingPaymentFilter, setAwaitingPaymentFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<OrdersPageSize>(DEFAULT_ORDERS_PAGE_SIZE);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set<OrderToggleableColumn>(readOrderVisibleColumns()));

  const debouncedSearch = useDebounce(searchQuery, 400);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const handleVisibleColumnsChange = (columns: Set<OrderToggleableColumn>) => {
    setVisibleColumns(columns);
    writeOrderVisibleColumns(columns);
  };

  const { employees } = useGetEmployees();
  const assigneeOptions = assignableTechnicians(employees);

  const { invoices, isUnavailable: invoicesUnavailable } = useGetInvoices();
  const { payments } = useGetPayments();
  const createInvoice = useCreateInvoice();
  const invoiceNumberByOrder = useMemo(() => new Map(invoices.flatMap((invoice) => (invoice.orderId ? [[invoice.orderId, invoice.invoiceNumber] as const] : []))), [invoices]);

  const handleCreateInvoice = (order: Order) => {
    if (createInvoice.isPending) return;
    createInvoice.mutate(order.id);
  };

  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    statusFilter !== "all" ||
    deadlineFilter !== "all" ||
    employeeFilter !== "all" ||
    awaitingPaymentFilter;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, deadlineFilter, employeeFilter, awaitingPaymentFilter, pageSize]);

  const {
    orders,
    total,
    page: resolvedPage,
    pageCount,
    isLoading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = useOrdersPage({
    search: debouncedSearch,
    status: statusFilter,
    deadline: deadlineFilter,
    employeeId: employeeFilter,
    today,
    page,
    pageSize,
  });

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

  const displayedOrders = useMemo(() => {
    if (!awaitingPaymentFilter) return orders;
    return orders.filter((order) => orderHasOutstandingBalance(order, payments));
  }, [awaitingPaymentFilter, orders, payments]);

  const displayedTotal = awaitingPaymentFilter ? displayedOrders.length : total;

  const awaitingPayment = useOrdersAwaitingPayment();
  const { canWrite: canCreateOrders } = useWorkspaceSubscription();

  function deactivateAwaitingPaymentFilter() {
    setAwaitingPaymentFilter(false);
  }

  function toggleAwaitingPaymentFilter() {
    setAwaitingPaymentFilter((active) => !active);
  }

  // Keep local page in sync when the server clamps (e.g. last row on a page was deleted).
  useEffect(() => {
    if (resolvedPage !== page) setPage(resolvedPage);
  }, [page, resolvedPage]);

  const rangeFrom = total === 0 ? 0 : (resolvedPage - 1) * pageSize + 1;
  const rangeTo = total === 0 ? 0 : Math.min(resolvedPage * pageSize, total);

  // Table columns — order # and actions stay fixed; the rest follow the Columns menu.
  const allColumns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: t("orders.table.orderNumber"),
      cell: (order) => <span className="font-medium text-primary tabular-nums">{order.orderNumber}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: t("orders.table.client"),
      cell: (order) => {
        const phone = order.clientPhone?.trim() || "—";
        return (
          <div className="max-w-[11rem] min-w-0 2xl:max-w-[13rem]">
            <div className="truncate font-medium" title={order.clientName}>
              {order.clientName}
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
      header: t("orders.table.clientType"),
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
    },
    {
      key: "device",
      header: copy.deviceServiceColumn,
      cell: (order) => (
        <div className="max-w-[11rem] min-w-0 2xl:max-w-[13rem]">
          <div className="truncate" title={order.device}>
            {order.device}
          </div>
          {order.service && (
            <div className="truncate text-xs text-muted-foreground" title={order.service}>
              {order.service}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (order) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={paymentStatusByOrder.get(order.id) ?? order.paymentStatus} />
        </div>
      ),
    },
    {
      key: "createdBy",
      header: t("orders.table.createdBy"),
      cell: (order) => {
        const creator = order.createdByName?.trim() || t("orders.table.unknownCreator");
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
      header: t("orders.table.assigned"),
      cell: (order) => (
        <span
          className="block max-w-[10rem] truncate text-muted-foreground"
          title={order.assignedEmployeeName || t("orders.detail.unassigned")}
        >
          {order.assignedEmployeeName || t("orders.detail.unassigned")}
        </span>
      ),
    },
    {
      key: "deadline",
      header: t("orders.table.deadline"),
      cell: (order) => (
        <span className={cn("tabular-nums", isOrderOverdue(order, today) ? "font-medium text-destructive" : "text-muted-foreground")}>
          {order.deadline || "—"}
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "total",
      header: t("common.total"),
      cell: (order) => <span className="font-medium tabular-nums">{formatMoney(order.totalPrice)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "actions",
      header: t("common.actions"),
      stickyRight: true,
      className: "w-[80px] text-right",
      cell: (order) => (
        <div className="flex justify-end gap-1">
          <OrderActionsMenu
            order={order}
            invoiceNumber={invoiceNumberByOrder.get(order.id)}
            linkedPaymentCount={paymentCountByOrder.get(order.id) ?? 0}
            invoicesUnavailable={invoicesUnavailable}
            isCreatingInvoice={createInvoice.isPending}
            isStatusUpdating={orderDetails.isStatusUpdating}
            requireTaxInvoiceNumber={orderDetails.requireTaxInvoiceNumber}
            onView={orderDetails.openOrder}
            onEdit={setEditingOrder}
            onStatusChange={orderDetails.changeStatus}
            onCreateInvoice={handleCreateInvoice}
            onDeleted={(orderId) => {
              orderDetails.clearOrder(orderId);
              setEditingOrder((current) => (current?.id === orderId ? null : current));
            }}
          />
        </div>
      ),
    },
  ];

  const columns = allColumns.filter((column) => column.key === "orderNumber" || column.key === "actions" || visibleColumns.has(column.key as OrderToggleableColumn));

  const statusOptions = [
    { value: "all", label: t("orders.filters.allStatuses") },
    ...orderStatuses.map((status) => ({ value: status, label: industryOrderStatusLabel(workflow, status) })),
  ];

  const deadlineOptions = [
    { value: "all", label: t("orders.filters.allDeadlines") },
    { value: "overdue", label: t("orders.filters.overdue") },
    { value: "upcoming", label: t("orders.filters.upcoming") },
  ];

  const employeeFilterOptions = [
    { value: "all", label: t("orders.filters.allEmployees") },
    ...assigneeOptions.map((technician) => ({
      value: technician.id,
      label: technician.name,
    })),
  ];

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setDeadlineFilter("all");
    setEmployeeFilter("all");
    setAwaitingPaymentFilter(false);
    setPage(1);
  };

  function emptyFilterState() {
    if (awaitingPaymentFilter && !debouncedSearch && statusFilter === "all" && deadlineFilter === "all" && employeeFilter === "all") {
      return <EmptyState title={t("orders.empty.noMatchesTitle")} description={t("orders.awaitingPayment.filterActiveHint")} />;
    }
    if (deadlineFilter === "overdue" && !debouncedSearch && statusFilter === "all" && employeeFilter === "all") {
      return <EmptyState title={t("orders.empty.noOverdueTitle")} description={t("orders.empty.noOverdueDescription")} />;
    }
    if (deadlineFilter === "upcoming" && !debouncedSearch && statusFilter === "all" && employeeFilter === "all") {
      return <EmptyState title={t("orders.empty.noUpcomingTitle")} description={t("orders.empty.noUpcomingDescription")} />;
    }
    if (statusFilter === "waiting-parts" && !debouncedSearch && deadlineFilter === "all" && employeeFilter === "all") {
      const statusLabel = industryOrderStatusLabel(workflow, "waiting-parts");
      return <EmptyState title={t("orders.empty.noWaitingTitle", { status: statusLabel })} description={t("orders.empty.noWaitingDescription")} />;
    }
    return <EmptyState title={t("orders.empty.noMatchesTitle")} description={t("orders.empty.noMatchesDescription")} />;
  }

  const headerDescription = hasActiveFilters
    ? t("orders.matchingCount", { count: displayedTotal })
    : t("orders.totalCount", { count: displayedTotal });

  const listTotal = awaitingPaymentFilter ? displayedOrders.length : total;
  const listRangeFrom = listTotal === 0 ? 0 : awaitingPaymentFilter ? (displayedOrders.length === 0 ? 0 : 1) : rangeFrom;
  const listRangeTo = listTotal === 0 ? 0 : awaitingPaymentFilter ? displayedOrders.length : rangeTo;

  const paginationSummary =
    listTotal === 0
      ? null
      : `${t("orders.pagination.showing", { from: listRangeFrom, to: listRangeTo, total: listTotal })} · ${t("orders.pagination.pageOf", {
          page: resolvedPage,
          pageCount,
        })}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("orders.title")}
        description={headerDescription}
        aside={
          <button
            type="button"
            aria-pressed={awaitingPaymentFilter}
            aria-label={t("orders.awaitingPayment.filterLabel")}
            title={awaitingPaymentFilter ? t("orders.awaitingPayment.filterActiveHint") : t("orders.awaitingPayment.filterLabel")}
            onClick={toggleAwaitingPaymentFilter}
            className={cn(
              "flex h-[calc(3rem*1.5)] min-w-0 max-w-full cursor-pointer items-center gap-3 rounded-lg border px-3.5 text-left shadow-xs transition-colors sm:max-w-[16rem]",
              awaitingPaymentFilter
                ? "border-primary/40 bg-primary/10 ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-accent/40",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md",
                statIconVariants[awaitingPaymentFilter || awaitingPayment.amount > 0 ? "primary" : "default"],
              )}
            >
              <Banknote aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium text-muted-foreground">{t("orders.awaitingPayment.title")}</p>
              {awaitingPayment.isLoading ? (
                <Skeleton className="mt-1 h-5 w-20" />
              ) : (
                <p className="mt-0.5 truncate text-base font-semibold tabular-nums tracking-tight text-foreground">
                  {awaitingPayment.error ? "—" : formatMoney(awaitingPayment.amount)}
                </p>
              )}
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {awaitingPayment.error
                  ? t("orders.awaitingPayment.loadFailed")
                  : awaitingPayment.count > 0
                    ? t("orders.awaitingPayment.unpaidCount", { count: awaitingPayment.count })
                    : t("orders.awaitingPayment.allPaid")}
              </p>
            </div>
          </button>
        }
        actions={
          canCreateOrders ? (
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus />
              {t("orders.createOrder")}
            </Button>
          ) : undefined
        }
      />

      <SubscriptionReadOnlyNotice />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <SearchAndFilters
          className="min-w-0 flex-1"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t("orders.searchPlaceholder")}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: statusOptions,
              value: statusFilter,
              onChange: (value) => {
                deactivateAwaitingPaymentFilter();
                setStatusFilter(value as OrderStatus | "all");
              },
            },
            {
              key: "deadline",
              label: t("orders.filters.deadline"),
              options: deadlineOptions,
              value: deadlineFilter,
              onChange: (value) => {
                deactivateAwaitingPaymentFilter();
                setDeadlineFilter(value as DeadlineFilter);
              },
            },
            {
              key: "employee",
              label: t("orders.filters.employee"),
              options: employeeFilterOptions,
              value: employeeFilter,
              onChange: (value) => {
                deactivateAwaitingPaymentFilter();
                setEmployeeFilter(value);
              },
            },
          ]}
          onClearFilters={clearFilters}
        />
        <OrderColumnsMenu
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={handleVisibleColumnsChange}
          deviceColumnLabel={copy.deviceServiceColumn}
        />
      </div>

      {isMobile ? (
        ordersLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
            {ordersError ? (
              <ErrorState title={t("orders.empty.loadFailed")} description={ordersError.message} onRetry={() => refetchOrders()} />
            ) : hasActiveFilters ? (
              emptyFilterState()
            ) : (
              <NoOrders onCreateOrder={canCreateOrders ? () => setCreateModalOpen(true) : undefined} />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {displayedOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                invoiceNumber={invoiceNumberByOrder.get(order.id)}
                linkedPaymentCount={paymentCountByOrder.get(order.id) ?? 0}
                invoicesUnavailable={invoicesUnavailable}
                isCreatingInvoice={createInvoice.isPending}
                isStatusUpdating={orderDetails.isStatusUpdating}
                requireTaxInvoiceNumber={orderDetails.requireTaxInvoiceNumber}
                paymentStatus={paymentStatusByOrder.get(order.id)}
                formatMoney={formatMoney}
                onView={orderDetails.openOrder}
                onEdit={setEditingOrder}
                onStatusChange={orderDetails.changeStatus}
                onCreateInvoice={handleCreateInvoice}
                onDeleted={(orderId) => {
                  orderDetails.clearOrder(orderId);
                  setEditingOrder((current) => (current?.id === orderId ? null : current));
                }}
              />
            ))}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          data={displayedOrders}
          keyExtractor={(order) => order.id}
          onRowClick={orderDetails.openOrder}
          isLoading={ordersLoading}
          emptyState={
            ordersError ? (
              <ErrorState title={t("orders.empty.loadFailed")} description={ordersError.message} onRetry={() => refetchOrders()} />
            ) : hasActiveFilters ? (
              emptyFilterState()
            ) : (
              <NoOrders onCreateOrder={canCreateOrders ? () => setCreateModalOpen(true) : undefined} />
            )
          }
        />
      )}

      {!ordersLoading && total > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ListPagination
            className="min-w-0 flex-1 sm:justify-between"
            page={resolvedPage}
            pageCount={pageCount}
            onPageChange={setPage}
            summary={paginationSummary}
          />
          <Select
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value) as OrdersPageSize)}
          >
            <SelectTrigger className="h-9 w-full text-[13px] sm:w-40" aria-label={t("orders.pagination.pageSize")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDERS_PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {t("orders.pagination.perPage", { count: size })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <CreateOrderDialog open={createModalOpen} onOpenChange={setCreateModalOpen} searchQuery={searchQuery} />

      <EditOrderDialog order={editingOrder} onClose={() => setEditingOrder(null)} onUpdated={orderDetails.syncOrder} />

      <OrderDetailPanel
        {...orderDetails.panelProps}
        invoiceNumber={
          orderDetails.panelProps.selectedOrder
            ? invoiceNumberByOrder.get(orderDetails.panelProps.selectedOrder.id)
            : undefined
        }
        onDeleted={(orderId) => {
          orderDetails.clearOrder(orderId);
          setEditingOrder((current) => (current?.id === orderId ? null : current));
        }}
      />
    </div>
  );
}
