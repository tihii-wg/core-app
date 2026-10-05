import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
          <DialogTitle>{t("orders.editDialog.title", { number: order?.orderNumber ?? "" })}</DialogTitle>
          <DialogDescription className="sr-only">{t("orders.editDialog.description")}</DialogDescription>
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
