import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import AddNewOrderForm from "./AddNewOrderForm";

export function CreateOrderDialog({ open, onOpenChange, searchQuery = "" }: { open: boolean; onOpenChange: (open: boolean) => void; searchQuery?: string }) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full owerflow-hidden ">
        <DialogHeader>
          <DialogTitle>{t("orders.createDialog.title")}</DialogTitle>
          <DialogDescription>{t("orders.createDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-2">
          <AddNewOrderForm setCreateModalOpen={onOpenChange} searchQuery={searchQuery} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
