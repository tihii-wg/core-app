import { useState, useMemo } from "react";

import { Pencil, Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { EmptyState, ErrorState, NoOrders } from "../../ui/EmptyState";
// import { Spinner } from "../../ui/Spinner";
import { useGetOrders } from "./useGetOrders";
import type { Order } from "../../lib/types";
import { useOrderDetails } from "./useOrderDetails";
import { CreateOrderDialog } from "./CreateOrderDialog";
import { EditOrderDialog } from "./EditOrderDialog";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import OrderDetailPanel from "./OrderDetailPanel";
import useGetEmployees from "../employees/useGetEmployees";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
// import FullPageDataSpinner from "../../ui/FullPageDataSpinner";

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "new", label: "New" },
  { value: "in-progress", label: "In Progress" },
  { value: "waiting-parts", label: "Waiting Parts" },
  { value: "completed", label: "Completed" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

// const employeeFilterOptions2 = [
//   { value: "all", label: "All Employees" },
//   { value: "emp-3", label: "Alex Turner" },
//   { value: "emp-4", label: "Sophie Brown" },
// ];

export function Orders() {
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
      header: "Order #",
      cell: (order) => <span className="font-medium text-primary tabular-nums">{order.orderNumber}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: "Client",
      cell: (order) => (
        <span className="block max-w-[11rem] truncate font-medium 2xl:max-w-[13rem]" title={order.clientName}>
          {order.clientName}
        </span>
      ),
    },
    {
      key: "clientType",
      header: "Client Type",
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
      className: "hidden 2xl:table-cell",
    },
    {
      key: "device",
      header: "Device/Service",
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
      header: "Status",
      cell: (order) => <OrderStatusBadge status={order.status} />,
    },
    {
      key: "employee",
      header: "Assigned",
      cell: (order) => (
        <span className="block max-w-[10rem] truncate text-muted-foreground" title={order.assignedEmployeeName}>
          {order.assignedEmployeeName || "—"}
        </span>
      ),
      className: "hidden min-[1800px]:table-cell",
    },
    {
      key: "deadline",
      header: "Deadline",
      cell: (order) => <span className="tabular-nums text-muted-foreground">{order.deadline || "—"}</span>,
      className: "hidden 2xl:table-cell whitespace-nowrap",
    },
    {
      key: "total",
      header: "Total",
      cell: (order) => <span className="font-medium tabular-nums">{formatMoney(order.totalPrice)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "payment",
      header: "Payment",
      cell: (order) => <PaymentStatusBadge status={order.paymentStatus} />,
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[80px] text-right",
      cell: (order) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit order ${order.orderNumber}`}
            onClick={(event) => {
              event.stopPropagation();
              setEditingOrder(order);
            }}
          >
            <Pencil />
          </Button>
        </div>
      ),
    },
  ];

  // if (ordersLoading || employeesIsLoading) {
  //   return <FullPageDataSpinner />;
  // }

  const employeeFilterOptions = [
    { value: "all", label: "All Employees" },
    ... (employees ?? []).map((employee) => ({
      value: employee.id,
      label: employee.name,
    })),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description={`${orders.length} total orders`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus />
            Create Order
          </Button>
        }
      />

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search orders..."

        filters={[
          {
            key: "status",
            label: "Status",
            options: statusOptions,
            value: statusFilter,
            onChange: setStatusFilter,
          },
          {
            key: "employee",
            label: "Employee",
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
            <ErrorState title="Could not load orders" description={ordersError.message} onRetry={() => refetchOrders()} />
          ) : searchQuery || statusFilter !== "all" || employeeFilter !== "all" ? (
            <EmptyState title="No orders match your filters" description="Try a different search term or clear the filters." />
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
