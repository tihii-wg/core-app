import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import AddNewClientForm from "./AddNewClienForm";

export function AddClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("clients.addDialog.title")}</DialogTitle>
          <DialogDescription>{t("clients.addDialog.description")}</DialogDescription>
        </DialogHeader>

        <AddNewClientForm setCreateModalOpen={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}
