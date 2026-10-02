import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { Order } from "../../lib/types";
import useGetEmployees from "../employees/useGetEmployees";
import EditOrderForm from "./EditOrderForm";

type EditOrderDialogProps = {
  order: Order | null;
  onClose: () => void;
  onUpdated?: (order: Order) => void;
};

export function EditOrderDialog({ order, onClose, onUpdated }: EditOrderDialogProps) {
  const { employees } = useGetEmployees();

  return (
    <Dialog
      open={Boolean(order)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Order {order?.orderNumber}</DialogTitle>
          <DialogDescription className="sr-only">Update the selected order's VIN, services, device, assignment, and deadline.</DialogDescription>
        </DialogHeader>
        {order && (
          <EditOrderForm
            key={order.id}
            order={order}
            employees={employees ?? []}
            onCancel={onClose}
            onUpdated={(updated) => {
              onUpdated?.(updated);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
