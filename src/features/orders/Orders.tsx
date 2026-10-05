import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { EmptyState, ErrorState, NoOrders } from "../../ui/EmptyState";
// import { Spinner } from "../../ui/Spinner";
import { useGetOrders } from "./useGetOrders";
import type { Order, OrderStatus } from "../../lib/types";
import { useOrderDetails } from "./useOrderDetails";
import { CreateOrderDialog } from "./CreateOrderDialog";
import { EditOrderDialog } from "./EditOrderDialog";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import OrderDetailPanel from "./OrderDetailPanel";
import useGetEmployees from "../employees/useGetEmployees";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { useCreateInvoice } from "../invoices/useCreateInvoice";
import { OrderActionsMenu } from "./OrderActionsMenu";
// import FullPageDataSpinner from "../../ui/FullPageDataSpinner";

const orderStatuses: OrderStatus[] = ["new", "in-progress", "waiting-parts", "completed", "paid", "cancelled"];

// const employeeFilterOptions2 = [
//   { value: "all", label: "All Employees" },
//   { value: "emp-3", label: "Alex Turner" },
//   { value: "emp-4", label: "Sophie Brown" },
// ];

export function Orders() {
  const { t } = useTranslation();
  const { orders, isLoading: ordersLoading, error: ordersError, refetch: refetchOrders } = useGetOrders();
  const { formatMoney } = useWorkspaceMoney();
  const orderDetails = useOrderDetails();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const { employees} = useGetEmployees();

  const { invoices, isUnavailable: invoicesUnavailable } = useGetInvoices();
  const createInvoice = useCreateInvoice();
  const invoiceNumberByOrder = useMemo(() => new Map(invoices.flatMap((invoice) => (invoice.orderId ? [[invoice.orderId, invoice.invoiceNumber] as const] : []))), [invoices]);

  const handleCreateInvoice = (order: Order) => {
    if (createInvoice.isPending) return;
    createInvoice.mutate(order.id);
  };

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
      const matchesEmployee = employeeFilter === "all" || order.assignedEmployeeId === employeeFilter;

      return matchesSearch && matchesStatus && matchesEmployee;
    });
  }, [orders, searchQuery, statusFilter, employeeFilter]);

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
      header: t("orders.table.deviceService"),
      cell: (order) => (
        <div className="max-w-[11rem] min-w-0 2xl:max-w-[13rem]">
          <div className="truncate" title={order.device}>{order.device}</div>
          {order.service && <div className="truncate text-xs text-muted-foreground" title={order.service}>{order.service}</div>}
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
        <span className="block max-w-[10rem] truncate text-muted-foreground" title={order.assignedEmployeeName}>
          {order.assignedEmployeeName || "—"}
        </span>
      ),
      className: "hidden min-[1800px]:table-cell",
    },
    {
      key: "deadline",
      header: t("orders.table.deadline"),
      cell: (order) => <span className="tabular-nums text-muted-foreground">{order.deadline || "—"}</span>,
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
            onEdit={setEditingOrder}
            onCreateInvoice={handleCreateInvoice}
          />
        </div>
      ),
    },
  ];

  // if (ordersLoading || employeesIsLoading) {
  //   return <FullPageDataSpinner />;
  // }

  const statusOptions = [{ value: "all", label: t("orders.filters.allStatuses") }, ...orderStatuses.map((status) => ({ value: status, label: t(`status.order.${status}`) }))];

  const employeeFilterOptions = [
    { value: "all", label: t("orders.filters.allEmployees") },
    ... (employees ?? []).map((employee) => ({
      value: employee.id,
      label: employee.name,
    })),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("orders.title")}
        description={t("orders.totalCount", { count: orders.length })}
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
            key: "employee",
            label: t("orders.filters.employee"),
            options: employeeFilterOptions,
            value: employeeFilter,
            onChange: setEmployeeFilter,
          },
        ]}
        onClearFilters={() => {
          setSearchQuery("");
          setStatusFilter("all");
          setEmployeeFilter("all");
        }}
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
          ) : searchQuery || statusFilter !== "all" || employeeFilter !== "all" ? (
            <EmptyState title={t("orders.empty.noMatchesTitle")} description={t("orders.empty.noMatchesDescription")} />
          ) : (
            <NoOrders onCreateOrder={() => setCreateModalOpen(true)} />
          )
        }
      />
      {/* {isLoading && <Spinner />} */}

      {/* Create Order Modal */}
      <CreateOrderDialog open={createModalOpen} onOpenChange={setCreateModalOpen} searchQuery={searchQuery} />

      <EditOrderDialog
        order={editingOrder}
        onClose={() => setEditingOrder(null)}
        onUpdated={orderDetails.syncOrder}
      />

      <OrderDetailPanel {...orderDetails.panelProps} />
    </div>
  );
}
