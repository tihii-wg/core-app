import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import AddNewOrderForm from "./AddNewOrderForm";

type CreateOrderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery?: string;
  /** Prefill the create form with an existing client (e.g. from the client details panel). */
  initialClient?: { id: string; name: string } | null;
};

export function CreateOrderDialog({ open, onOpenChange, searchQuery = "", initialClient = null }: CreateOrderDialogProps) {
  const { t } = useTranslation();
  const formSearch = searchQuery || initialClient?.name || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full owerflow-hidden ">
        <DialogHeader>
          <DialogTitle>{t("orders.createDialog.title")}</DialogTitle>
          <DialogDescription>{t("orders.createDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-2">
          {open ? (
            <AddNewOrderForm
              key={initialClient?.id ?? (formSearch || "new-order")}
              setCreateModalOpen={onOpenChange}
              searchQuery={formSearch}
              initialClientId={initialClient?.id}
              initialClientName={initialClient?.name}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
