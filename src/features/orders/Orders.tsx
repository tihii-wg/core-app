import { useState, useMemo } from "react";

import { Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { NoOrders } from "../../ui/EmptyState";
// import { Spinner } from "../../ui/Spinner";
import { useGetOrders, useUpdateOrderStatus } from "./useGetOrders";
import type { OrderStatus, Order } from "../../lib/types";
import AddNewOrderForm from "../orders/AddNewOrderForm";
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
  const { orders, isLoading: ordersLoading } = useGetOrders();
  const { formatMoney } = useWorkspaceMoney();
  const { mutate: updateStatus } = useUpdateOrderStatus();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

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
  ];

  const handleRowClick = (order: Order) => {
    setSelectedOrder(order);
    setDetailPanelOpen(true);
  };

  const handleStatusChange = (newStatus: OrderStatus) => {
    if (selectedOrder) {
      updateStatus({ orderId: selectedOrder.id, status: newStatus });
      setSelectedOrder({
        ...selectedOrder,
        status: newStatus,
        ...(newStatus === "paid" ? { isPaid: true, paymentStatus: "paid" as const } : {}),
      });
    }
  };

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

      <DataTable
        columns={columns}
        data={filteredOrders}
        keyExtractor={(order) => order.id}
        onRowClick={handleRowClick}
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
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg w-full owerflow-hidden ">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
            <DialogDescription>Fill in the information to create a new order</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto pr-2">
            <AddNewOrderForm setCreateModalOpen={setCreateModalOpen} searchQuery={searchQuery} />
          </div>
        </DialogContent>
      </Dialog>

      <OrderDetailPanel
        selectedOrder={selectedOrder}
        detailPanelOpen={detailPanelOpen}
        setDetailPanelOpen={setDetailPanelOpen}
        // employees={employees ?? []}
        onOrderUpdated={setSelectedOrder}
        onStatusChange={handleStatusChange}
      />
    </div>
  );
}
