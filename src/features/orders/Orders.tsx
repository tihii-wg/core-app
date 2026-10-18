import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { EmptyState, ErrorState, NoOrders } from "../../ui/EmptyState";
import { useGetOrders } from "./useGetOrders";
import type { Order, OrderStatus } from "../../lib/types";
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
import { OrderActionsMenu } from "./OrderActionsMenu";
import { localDateKey } from "../../pages/dashboardStats";
import { cn } from "../../lib/utils";
import { isOrderOverdue, matchesDeadlineFilter, type DeadlineFilter } from "./orderVisibility";

const orderStatuses: OrderStatus[] = ORDER_STATUSES;

export function Orders() {
  const { t } = useTranslation();
  const { workflow, copy } = useIndustryWorkflow();
  const { orders, isLoading: ordersLoading, error: ordersError, refetch: refetchOrders } = useGetOrders();
  const { formatMoney } = useWorkspaceMoney();
  const orderDetails = useOrderDetails();
  const today = localDateKey(new Date());

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const { employees } = useGetEmployees();
  const assigneeOptions = assignableTechnicians(employees);

  const { invoices, isUnavailable: invoicesUnavailable } = useGetInvoices();
  const createInvoice = useCreateInvoice();
  const invoiceNumberByOrder = useMemo(() => new Map(invoices.flatMap((invoice) => (invoice.orderId ? [[invoice.orderId, invoice.invoiceNumber] as const] : []))), [invoices]);

  const handleCreateInvoice = (order: Order) => {
    if (createInvoice.isPending) return;
    createInvoice.mutate(order.id);
  };

  const hasActiveFilters = Boolean(searchQuery) || statusFilter !== "all" || deadlineFilter !== "all" || employeeFilter !== "all";

  // Filtered data
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        !searchQuery ||
        order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.device.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.vin.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesDeadline = matchesDeadlineFilter(order, deadlineFilter, today);
      const matchesEmployee = employeeFilter === "all" || order.assignedEmployeeId === employeeFilter;

      return matchesSearch && matchesStatus && matchesDeadline && matchesEmployee;
    });
  }, [orders, searchQuery, statusFilter, deadlineFilter, employeeFilter, today]);

  // Table columns
  const columns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: t("orders.table.orderNumber"),
      cell: (order) => <span className="font-medium text-primary tabular-nums">{order.orderNumber}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: t("orders.table.client"),
      cell: (order) => (
        <span className="block max-w-[11rem] truncate font-medium 2xl:max-w-[13rem]" title={order.clientName}>
          {order.clientName}
        </span>
      ),
    },
    {
      key: "clientType",
      header: t("orders.table.clientType"),
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
      className: "hidden 2xl:table-cell",
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
      className: "hidden xl:table-cell",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (order) => <OrderStatusBadge status={order.status} />,
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
      className: "hidden min-[1800px]:table-cell",
    },
    {
      key: "deadline",
      header: t("orders.table.deadline"),
      cell: (order) => (
        <span className={cn("tabular-nums", isOrderOverdue(order, today) ? "font-medium text-destructive" : "text-muted-foreground")}>
          {order.deadline || "—"}
        </span>
      ),
      className: "hidden 2xl:table-cell whitespace-nowrap",
    },
    {
      key: "total",
      header: t("common.total"),
      cell: (order) => <span className="font-medium tabular-nums">{formatMoney(order.totalPrice)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "payment",
      header: t("orders.table.payment"),
      cell: (order) => <PaymentStatusBadge status={order.paymentStatus} />,
    },
    {
      key: "actions",
      header: t("common.actions"),
      className: "w-[80px] text-right",
      cell: (order) => (
        <div className="flex justify-end gap-1">
          <OrderActionsMenu
            order={order}
            invoiceNumber={invoiceNumberByOrder.get(order.id)}
            invoicesUnavailable={invoicesUnavailable}
            isCreatingInvoice={createInvoice.isPending}
            isStatusUpdating={orderDetails.isStatusUpdating}
            onView={orderDetails.openOrder}
            onEdit={setEditingOrder}
            onStatusChange={orderDetails.changeStatus}
            onCreateInvoice={handleCreateInvoice}
          />
        </div>
      ),
    },
  ];

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
  };

  function emptyFilterState() {
    if (deadlineFilter === "overdue" && !searchQuery && statusFilter === "all" && employeeFilter === "all") {
      return <EmptyState title={t("orders.empty.noOverdueTitle")} description={t("orders.empty.noOverdueDescription")} />;
    }
    if (deadlineFilter === "upcoming" && !searchQuery && statusFilter === "all" && employeeFilter === "all") {
      return <EmptyState title={t("orders.empty.noUpcomingTitle")} description={t("orders.empty.noUpcomingDescription")} />;
    }
    if (statusFilter === "waiting-parts" && !searchQuery && deadlineFilter === "all" && employeeFilter === "all") {
      const statusLabel = industryOrderStatusLabel(workflow, "waiting-parts");
      return <EmptyState title={t("orders.empty.noWaitingTitle", { status: statusLabel })} description={t("orders.empty.noWaitingDescription")} />;
    }
    return <EmptyState title={t("orders.empty.noMatchesTitle")} description={t("orders.empty.noMatchesDescription")} />;
  }

  const headerDescription = hasActiveFilters
    ? t("orders.filteredCount", { shown: filteredOrders.length, total: orders.length })
    : t("orders.totalCount", { count: orders.length });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("orders.title")}
        description={headerDescription}
        actions={
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus />
            {t("orders.createOrder")}
          </Button>
        }
      />

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t("orders.searchPlaceholder")}
        filters={[
          {
            key: "status",
            label: t("common.status"),
            options: statusOptions,
            value: statusFilter,
            onChange: setStatusFilter,
          },
          {
            key: "deadline",
            label: t("orders.filters.deadline"),
            options: deadlineOptions,
            value: deadlineFilter,
            onChange: (value) => setDeadlineFilter(value as DeadlineFilter),
          },
          {
            key: "employee",
            label: t("orders.filters.employee"),
            options: employeeFilterOptions,
            value: employeeFilter,
            onChange: setEmployeeFilter,
          },
        ]}
        onClearFilters={clearFilters}
      />

      <DataTable
        columns={columns}
        data={filteredOrders}
        keyExtractor={(order) => order.id}
        onRowClick={orderDetails.openOrder}
        isLoading={ordersLoading}
        emptyState={
          ordersError ? (
            <ErrorState title={t("orders.empty.loadFailed")} description={ordersError.message} onRetry={() => refetchOrders()} />
          ) : hasActiveFilters ? (
            emptyFilterState()
          ) : (
            <NoOrders onCreateOrder={() => setCreateModalOpen(true)} />
          )
        }
      />

      <CreateOrderDialog open={createModalOpen} onOpenChange={setCreateModalOpen} searchQuery={searchQuery} />

      <EditOrderDialog order={editingOrder} onClose={() => setEditingOrder(null)} onUpdated={orderDetails.syncOrder} />

      <OrderDetailPanel {...orderDetails.panelProps} />
    </div>
  );
}
