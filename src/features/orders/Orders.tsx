import { useState, useMemo } from "react";
import { Plus, Calendar } from "lucide-react";
import { Button } from "../../ui/Button";
// import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
// import { Textarea } from "../../ui/Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { NoOrders } from "../../ui/EmptyState";
import { Spinner } from "../../ui/Spinner";
import { useApp } from "../../lib/appContext";
import type { Order, OrderStatus } from "../../lib/types";
import { useGetClients } from "../clients/useGetClients";
import AddNewOrdderForm from "../orders/AddNewOrderForm";

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "new", label: "New" },
  { value: "in-progress", label: "In Progress" },
  { value: "waiting-parts", label: "Waiting Parts" },
  { value: "completed", label: "Completed" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const employeeFilterOptions = [
  { value: "all", label: "All Employees" },
  { value: "emp-3", label: "Alex Turner" },
  { value: "emp-4", label: "Sophie Brown" },
];

export function Orders() {
  const { orders, updateOrderStatus } = useApp();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const { isLoading } = useGetClients(searchQuery);

  // Filtered data
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        !searchQuery ||
        order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.device.toLowerCase().includes(searchQuery.toLowerCase());

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
      cell: (order) => `$${order.totalPrice}`,
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
      updateOrderStatus(selectedOrder.id, newStatus);
      setSelectedOrder({ ...selectedOrder, status: newStatus });
    }
  };

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
      {isLoading && <Spinner />}
      {/* Create Order Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg ">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
          </DialogHeader>

          <AddNewOrdderForm setCreateModalOpen={setCreateModalOpen} searchQuery={searchQuery} />
        </DialogContent>
      </Dialog>

      {/* Order Detail Panel */}
      <Sheet open={detailPanelOpen} onOpenChange={setDetailPanelOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {selectedOrder?.orderNumber}
              {selectedOrder && <OrderStatusBadge status={selectedOrder.status} />}
            </SheetTitle>
          </SheetHeader>

          {selectedOrder && (
            <div className="mt-6 space-y-6 mx-3">
              {/* Client Info */}
              <div className="bg-[#f8f9fa] rounded-md p-4">
                <h3 className="text-sm font-medium text-[#939699] mb-2">Client</h3>
                <p className="font-medium text-[#282e33]">{selectedOrder.clientName}</p>
              </div>

              {/* Order Details */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-[#939699]">Device</p>
                    <p className="font-medium text-[#282e33]">{selectedOrder.device}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[#939699]">Service</p>
                    <p className="font-medium text-[#282e33]">{selectedOrder.service}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-[#939699]">Description</p>
                  <p className="text-[#282e33]">{selectedOrder.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-[#939699]">Assigned To</p>
                    <p className="font-medium text-[#282e33]">{selectedOrder.assignedEmployeeName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[#939699]">Deadline</p>
                    <p className="font-medium text-[#282e33] flex items-center gap-1">
                      <Calendar className="h-4 w-4 text-[#939699]" />
                      {selectedOrder.deadline}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-[#939699]">Total Price</p>
                    <p className="text-xl font-semibold text-[#282e33]">${selectedOrder.totalPrice}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[#939699]">Payment Status</p>
                    <PaymentStatusBadge status={selectedOrder.paymentStatus} />
                  </div>
                </div>
              </div>

              {/* Update Status */}
              <div className="border-t border-[#eeeeef] pt-4">
                <Label className="mb-2 block">Update Status</Label>
                <Select value={selectedOrder.status} onValueChange={handleStatusChange as (value: string) => void}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="waiting-parts">Waiting Parts</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Timestamps */}
              <div className="text-xs text-[#939699] space-y-1">
                <p>Created: {selectedOrder.createdAt}</p>
                <p>Updated: {selectedOrder.updatedAt}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
