import { useState } from "react";
import { Calendar, Pencil } from "lucide-react";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import type { Order, OrderStatus } from "../../lib/types";
import EditOrderForm from "./EditOrderForm";
import useGetEmployees from "../employees/useGetEmployees";

type OrderDetailPanelProps = {
  selectedOrder: Order | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  // employees: Employee[];
  onOrderUpdated: (order: Order) => void;
  onStatusChange: (status: OrderStatus) => void;
};

export default function OrderDetailPanel({ selectedOrder, detailPanelOpen, setDetailPanelOpen, onOrderUpdated, onStatusChange }: OrderDetailPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState(selectedOrder?.id);
  const { employees,} = useGetEmployees();


  if (selectedOrder?.id !== editingOrderId) {
    setEditingOrderId(selectedOrder?.id);
    setIsEditing(false);
  }

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) setIsEditing(false);
  }

  return (
    <Sheet open={detailPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-16">
            {selectedOrder?.orderNumber}
            {selectedOrder && !isEditing && <OrderStatusBadge status={selectedOrder.status} />}
          </SheetTitle>
          {selectedOrder && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label="Edit"
              className="ring-offset-background focus:ring-ring absolute top-4 right-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <SheetDescription className="sr-only">View and edit this order's VIN, services, device, assignment, and deadline.</SheetDescription>
        </SheetHeader>

        {selectedOrder && isEditing && (
          <div className="mx-4 mt-2">
            <EditOrderForm
              key={selectedOrder.id}
              order={selectedOrder}
              employees={employees}
              onCancel={() => setIsEditing(false)}
              onUpdated={(order) => {
                onOrderUpdated(order);
                setIsEditing(false);
                setDetailPanelOpen(false);
              }}
            />
          </div>
        )}

        {selectedOrder && !isEditing && (
          <div className="mt-6 space-y-6 mx-3">
            <div className="bg-[#f8f9fa] rounded-md p-4">
              <h3 className="text-sm font-medium text-[#939699] mb-2">Client</h3>
              <p className="font-medium text-[#282e33]">{selectedOrder.clientName}</p>
            </div>

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
                  <p className="text-sm text-[#939699]">Car Number</p>
                  <p className="font-medium text-[#282e33]">{selectedOrder.carNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-[#939699]">VIN</p>
                  <p className="font-medium text-[#282e33]">{selectedOrder.vin}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-[#939699]">Assigned To</p>
                  <p className="font-medium text-[#282e33]">{selectedOrder.assignedEmployeeName}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-[#939699]">Deadline</p>
                  <p className="font-medium text-[#282e33] flex items-center gap-1">
                    <Calendar className="h-4 w-4 text-[#939699]" />
                    {selectedOrder.deadline}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[#939699]">Total Price</p>
                  <p className="text-xl font-semibold text-[#282e33]">${selectedOrder.totalPrice}</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-[#939699]">Payment Status</p>
                <PaymentStatusBadge status={selectedOrder.paymentStatus} />
              </div>
            </div>

            <div className="border-t border-[#eeeeef] pt-4">
              <Label className="mb-2 block">Update Status</Label>
              <Select value={selectedOrder.status} onValueChange={onStatusChange as (value: string) => void}>
                <SelectTrigger id="order-status">
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

            <div className="text-xs text-[#939699] space-y-1">
              <p>Created: {selectedOrder.createdAt}</p>
              <p>Updated: {selectedOrder.updatedAt}</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
