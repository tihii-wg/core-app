import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import AddNewOrderForm from "./AddNewOrderForm";

export function CreateOrderDialog({ open, onOpenChange, searchQuery = "" }: { open: boolean; onOpenChange: (open: boolean) => void; searchQuery?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full owerflow-hidden ">
        <DialogHeader>
          <DialogTitle>Create New Order</DialogTitle>
          <DialogDescription>Fill in the information to create a new order</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-2">
          <AddNewOrderForm setCreateModalOpen={onOpenChange} searchQuery={searchQuery} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
