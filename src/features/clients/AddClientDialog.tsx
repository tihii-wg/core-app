import type { Client } from "../../lib/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { industryClientCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import AddNewClientForm from "./AddNewClienForm";

type AddClientDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated?: (result: { client: Client; vehicleId: string | null }) => void;
};

export function AddClientDialog({ open, onOpenChange, initialName, onCreated }: AddClientDialogProps) {
  const { workflow } = useIndustryWorkflow();
  const copy = industryClientCopy(workflow);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.addDialogTitle}</DialogTitle>
          <DialogDescription>{copy.addDialogDescription}</DialogDescription>
        </DialogHeader>

        <AddNewClientForm setCreateModalOpen={onOpenChange} initialName={initialName} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}
