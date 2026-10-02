import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import AddNewClientForm from "./AddNewClienForm";

export function AddClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
          <DialogDescription>Fill in client details below</DialogDescription>
        </DialogHeader>

        <AddNewClientForm setCreateModalOpen={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}
