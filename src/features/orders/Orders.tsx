import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Banknote, Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { ListPagination } from "../../ui/ListPagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { EmptyState, ErrorState, NoOrders } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { useOrdersAwaitingPayment, useOrdersPage } from "./useGetOrders";
import { statIconVariants } from "../../ui/statCardStyles";
import type { Order } from "../../lib/types";
import { useDebounce } from "../../hooks/useDebounce";
import {
  DEFAULT_ORDERS_PAGE_SIZE,
  ORDERS_PAGE_SIZES,
  type OrdersPageSize,
} from "../../services/apiOrders";
import { industryOrderStatusLabel } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useOrderDetails } from "./useOrderDetails";
import { CreateOrderDialog } from "./CreateOrderDialog";
import { EditOrderDialog } from "./EditOrderDialog";
import OrderDetailPanel from "./OrderDetailPanel";
import useGetEmployees from "../employees/useGetEmployees";
import { assignableTechnicians } from "./assignableTechnicians";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { OrderColumnsMenu } from "./OrderColumnsMenu";
import { OrdersBoard } from "./OrdersBoard";
import { OrdersCalendar } from "./OrdersCalendar";
import { OrderViewToggle } from "./OrderViewToggle";
import { OrdersListView } from "./OrdersListView";
import { isOrderStatus, readOrderViewMode, writeOrderViewMode, type OrderViewMode } from "./orderBoard";
import {
  readOrderVisibleColumns,
  writeOrderVisibleColumns,
  type OrderToggleableColumn,
} from "./orderColumnVisibility";
import { useOrderFieldConfig } from "./useOrderFieldConfig";
import { localDateKey } from "../../pages/dashboardStats";
import { cn } from "../../lib/utils";
import { type DeadlineFilter } from "./orderVisibility";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { useGetPayments } from "../finance/usePayments";
import { orderHasOutstandingBalance } from "../finance/paymentCalculations";
import { ClientDetailsHost } from "../clients/ClientDetailsHost";
import { useOpenClientDetails } from "../clients/useOpenClientDetails";
import type { Client } from "../../lib/types";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { hasConfigurableOrderStatuses, unifiedStatusFilterOptions } from "./unifiedOrderStatus";

export function Orders() {
  const { t } = useTranslation();
  const { workflow, copy } = useIndustryWorkflow();
  const { fields: orderFieldConfig } = useOrderFieldConfig();
  const deviceColumnLabel =
    orderFieldConfig.find((field) => field.key === "vehicleLicensePlate")?.label ??
    orderFieldConfig.find((field) => field.key === "vehicleMake")?.label ??
    orderFieldConfig.find((field) => field.key === "vehicle")?.label ??
    orderFieldConfig.find((field) => field.key === "device")?.label ??
    copy.deviceServiceColumn;
  const { formatMoney } = useWorkspaceMoney();
  const orderDetails = useOrderDetails();
  const clientDetails = useOpenClientDetails();
  const [orderForClient, setOrderForClient] = useState<Client | null>(null);
  const [orderForVehicleId, setOrderForVehicleId] = useState<string | null>(null);
  const today = localDateKey(new Date());

  function openClientFromOrder(clientId: string) {
    orderDetails.panelProps.setDetailPanelOpen(false);
    void clientDetails.openClient(clientId);
  }

  // Filters / pagination (server-side via getOrdersPage)
  const [searchQuery, setSearchQuery] = useState("");
  /** "all" | status_definitions.id | system OrderStatus (fallback when no definitions). */
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  /** Toggle: when true, list only orders with ledger remaining > 0. */
  const [awaitingPaymentFilter, setAwaitingPaymentFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<OrdersPageSize>(DEFAULT_ORDERS_PAGE_SIZE);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set<OrderToggleableColumn>(readOrderVisibleColumns()));
  const [viewMode, setViewMode] = useState<OrderViewMode>(() => readOrderViewMode());
  const isBoard = viewMode === "board";
  const isCalendar = viewMode === "calendar";

  const handleViewModeChange = (mode: OrderViewMode) => {
    setViewMode(mode);
    writeOrderViewMode(mode);
  };

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
  const { data: orderStatusDefinitions = [] } = useGetStatusDefinitions("order");
  const unifiedFilterOptions = useMemo(
    () => unifiedStatusFilterOptions(orderStatusDefinitions, (status) => industryOrderStatusLabel(workflow, status)),
    [orderStatusDefinitions, workflow],
  );
  const usesDefinitionFilter = hasConfigurableOrderStatuses(orderStatusDefinitions);
  const selectedFilterOption = statusFilter === "all" ? null : unifiedFilterOptions.find((option) => option.id === statusFilter) ?? null;

  const { invoices } = useGetInvoices();
  const { payments, isLoading: paymentsLoading, error: paymentsError } = useGetPayments();
  const invoiceNumberByOrder = useMemo(() => new Map(invoices.flatMap((invoice) => (invoice.orderId ? [[invoice.orderId, invoice.invoiceNumber] as const] : []))), [invoices]);

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
    status: (() => {
      if (usesDefinitionFilter || statusFilter === "all") return "all";
      const raw = statusFilter.startsWith("system:") ? statusFilter.slice("system:".length) : statusFilter;
      return isOrderStatus(raw) ? raw : "all";
    })(),
    customStatusId: usesDefinitionFilter && statusFilter !== "all" ? statusFilter : "all",
    customStatusFallbackSystem: usesDefinitionFilter ? selectedFilterOption?.systemStatus ?? null : null,
    deadline: deadlineFilter,
    employeeId: employeeFilter,
    today,
    page,
    pageSize,
  }, { enabled: !isBoard && !isCalendar });

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
    // The payment filter only applies to the table; switch back so the click has a visible effect.
    if (isBoard || isCalendar) handleViewModeChange("table");
    setAwaitingPaymentFilter((active) => !active);
  }

  // Keep local page in sync when the server clamps (e.g. last row on a page was deleted).
  useEffect(() => {
    if (resolvedPage !== page) setPage(resolvedPage);
  }, [page, resolvedPage]);

  const rangeFrom = total === 0 ? 0 : (resolvedPage - 1) * pageSize + 1;
  const rangeTo = total === 0 ? 0 : Math.min(resolvedPage * pageSize, total);

  const statusOptions = [
    { value: "all", label: t("orders.filters.allStatuses") },
    ...unifiedFilterOptions.map((option) => ({ value: option.id, label: option.name })),
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
    if (
      selectedFilterOption?.systemStatus === "waiting-parts" &&
      !debouncedSearch &&
      deadlineFilter === "all" &&
      employeeFilter === "all"
    ) {
      return (
        <EmptyState
          title={t("orders.empty.noWaitingTitle", { status: selectedFilterOption.name })}
          description={t("orders.empty.noWaitingDescription")}
        />
      );
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

  const listEmptyState = ordersError ? (
    <ErrorState title={t("orders.empty.loadFailed")} description={ordersError.message} onRetry={() => refetchOrders()} />
  ) : hasActiveFilters ? (
    emptyFilterState()
  ) : (
    <NoOrders onCreateOrder={canCreateOrders ? () => setCreateModalOpen(true) : undefined} />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("orders.title")}
        description={isBoard || isCalendar ? undefined : headerDescription}
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
            // Board columns already are the statuses (and the calendar lists every status), so the status filter is table-only.
            ...(isBoard || isCalendar
              ? []
              : [
                  {
                    key: "status",
                    label: t("common.status"),
                    options: statusOptions,
                    value: statusFilter,
                    onChange: (value: string) => {
                      deactivateAwaitingPaymentFilter();
                      setStatusFilter(value);
                    },
                  },
                ]),
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">
          <OrderViewToggle value={viewMode} onChange={handleViewModeChange} />
          {isBoard || isCalendar ? null : (
            <OrderColumnsMenu
              visibleColumns={visibleColumns}
              onVisibleColumnsChange={handleVisibleColumnsChange}
              deviceColumnLabel={deviceColumnLabel}
              fieldConfig={orderFieldConfig}
            />
          )}
        </div>
      </div>

      {isBoard ? (
        <OrdersBoard
          search={debouncedSearch}
          employeeFilter={employeeFilter}
          deadlineFilter={deadlineFilter}
          today={today}
          isWorkspaceOwner={orderDetails.isWorkspaceOwner}
          requireTaxInvoiceNumber={orderDetails.requireTaxInvoiceNumber}
          formatMoney={formatMoney}
          onOpenOrder={orderDetails.openOrder}
          payments={paymentsLoading || paymentsError ? undefined : payments}
        />
      ) : isCalendar ? (
        <OrdersCalendar
          search={debouncedSearch}
          employeeFilter={employeeFilter}
          deadlineFilter={deadlineFilter}
          today={today}
          formatMoney={formatMoney}
          onOpenOrder={orderDetails.openOrder}
        />
      ) : (
        <OrdersListView
          orders={displayedOrders}
          isLoading={ordersLoading}
          emptyState={listEmptyState}
          orderDetails={orderDetails}
          onEdit={setEditingOrder}
          onDeleted={(orderId) => {
            orderDetails.clearOrder(orderId);
            setEditingOrder((current) => (current?.id === orderId ? null : current));
          }}
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={handleVisibleColumnsChange}
          onOpenClient={openClientFromOrder}
        />
      )}

      {!isBoard && !isCalendar && !ordersLoading && total > 0 ? (
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

      <CreateOrderDialog
        open={createModalOpen || Boolean(orderForClient)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateModalOpen(false);
            setOrderForClient(null);
            setOrderForVehicleId(null);
          }
        }}
        searchQuery={orderForClient ? "" : searchQuery}
        initialClient={orderForClient ? { id: orderForClient.id, name: orderForClient.name } : null}
        initialVehicleId={orderForVehicleId}
      />

      <ClientDetailsHost
        selectedClient={clientDetails.selectedClient}
        detailPanelOpen={clientDetails.detailPanelOpen}
        setDetailPanelOpen={clientDetails.setDetailPanelOpen}
        onClientUpdated={clientDetails.onClientUpdated}
        onClientDeleted={clientDetails.onClientDeleted}
        onOpenOrder={(order) => {
          clientDetails.setDetailPanelOpen(false);
          orderDetails.openOrder(order);
        }}
        onCreateOrder={(client, vehicleId) => {
          setOrderForClient(client);
          setOrderForVehicleId(vehicleId ?? null);
        }}
      />

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
