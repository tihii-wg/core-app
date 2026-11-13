import { useTranslation } from "react-i18next";
import type { OrderKind } from "../../lib/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import AddNewOrderForm from "./AddNewOrderForm";

type CreateOrderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery?: string;
  /** Prefill the create form with an existing client (e.g. from the client details panel). */
  initialClient?: { id: string; name: string } | null;
  /** Prefill `orders.vehicle_id` for a vehicle that belongs to `initialClient`. */
  initialVehicleId?: string | null;
  /** Create an estimate (same form; no stock issue). */
  kind?: OrderKind;
  /** The order was saved (not cancelled) — e.g. close the client card the order was started from. */
  onCreated?: () => void;
};

export function CreateOrderDialog({
  open,
  onOpenChange,
  searchQuery = "",
  initialClient = null,
  initialVehicleId = null,
  kind = "order",
  onCreated,
}: CreateOrderDialogProps) {
  const { t } = useTranslation();
  const isEstimate = kind === "estimate";
  const formSearch = searchQuery || initialClient?.name || "";
  const formKey = `${kind}:${initialClient?.id ?? "new"}:${initialVehicleId ?? ""}:${formSearch || "new-order"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg w-full owerflow-hidden "
        // Do not autofocus the client field — that would open the clients dropdown on mount.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {isEstimate ? t("orders.estimates.createDialog.title") : t("orders.createDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {isEstimate ? t("orders.estimates.createDialog.description") : t("orders.createDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-2">
          {open ? (
            <AddNewOrderForm
              key={formKey}
              setCreateModalOpen={onOpenChange}
              searchQuery={formSearch}
              initialClientId={initialClient?.id}
              initialClientName={initialClient?.name}
              initialVehicleId={initialVehicleId ?? undefined}
              kind={kind}
              onCreated={onCreated}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
