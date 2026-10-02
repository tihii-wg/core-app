import { useState, useMemo } from "react";

import { Pencil, Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { NoOrders } from "../../ui/EmptyState";
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
  const { orders, isLoading: ordersLoading, error: ordersError } = useGetOrders();
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
      cell: (order) => <span className="font-medium text-[#1973e1]">{order.orderNumber}</span>,
    },
    {
      key: "client",
      header: "Client",
      cell: (order) => order.clientName,
    },
    {
      key: "clientType",
      header: "Client Type",
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
    },
    {
      key: "device",
      header: "Device/Service",
      cell: (order) => (
        <div>
          <div className="font-medium">{order.device}</div>
          <div className="text-xs text-[#939699]">{order.service}</div>
        </div>
      ),
      className: "hidden md:table-cell",
    },
    {
      key: "status",
      header: "Status",
      cell: (order) => <OrderStatusBadge status={order.status} />,
    },
    {
      key: "employee",
      header: "Assigned",
      cell: (order) => order.assignedEmployeeName,
      className: "hidden lg:table-cell",
    },
    {
      key: "deadline",
      header: "Deadline",
      cell: (order) => order.deadline,
      className: "hidden sm:table-cell",
    },
    {
      key: "total",
      header: "Total",
      cell: (order) => formatMoney(order.totalPrice),
      className: "text-right",
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
            variant="outline"
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
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description={`${orders.length} total orders`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
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

      {ordersError && <p className="text-sm text-[#f41f20]">{ordersError.message}</p>}

      <DataTable
        columns={columns}
        data={filteredOrders}
        keyExtractor={(order) => order.id}
        onRowClick={orderDetails.openOrder}
        isLoading={ordersLoading}
        emptyState={
          searchQuery || statusFilter !== "all" || employeeFilter !== "all" ? (
            <div className="py-12 text-center">
              <p className="text-[#939699]">No orders match your filters</p>
            </div>
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
