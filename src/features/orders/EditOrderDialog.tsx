import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getOrder } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { Spinner } from "../../ui/Spinner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { Order } from "../../lib/types";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import EditOrderForm from "./EditOrderForm";

type EditOrderDialogProps = {
  order: Order | null;
  onClose: () => void;
  onUpdated?: (order: Order) => void;
};

export function EditOrderDialog({ order, onClose, onUpdated }: EditOrderDialogProps) {
  const { t } = useTranslation();
  const { copy } = useIndustryWorkflow();
  const { workspaceId } = useActiveWorkspaceId();
  // A row of a lightweight list has no lines: the form would show (and on save send) an empty line list.
  const needsFull = Boolean(order?.linesOmitted);
  const fullQuery = useQuery({
    queryKey: ["order", order?.id, "edit"],
    queryFn: () => getOrder(order!.id, workspaceId),
    enabled: needsFull && Boolean(workspaceId),
    staleTime: 0,
    gcTime: 0,
  });
  const formOrder = needsFull ? (fullQuery.data ?? null) : order;

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
          <DialogDescription className="sr-only">{copy.editDescription}</DialogDescription>
        </DialogHeader>
        {needsFull && !formOrder ? (
          <div className="flex justify-center py-10">
            {fullQuery.isError ? (
              <p className="text-sm text-destructive">{fullQuery.error instanceof Error ? fullQuery.error.message : ""}</p>
            ) : (
              <Spinner />
            )}
          </div>
        ) : null}
        {formOrder && (
          <EditOrderForm
            key={formOrder.id}
            order={formOrder}
            onCancel={onClose}
            onOrderSynced={(updated) => onUpdated?.(updated)}
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
