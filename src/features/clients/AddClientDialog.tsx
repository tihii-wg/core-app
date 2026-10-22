import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { industryClientCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import AddNewClientForm from "./AddNewClienForm";

export function AddClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { workflow } = useIndustryWorkflow();
  const copy = industryClientCopy(workflow);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.addDialogTitle}</DialogTitle>
          <DialogDescription>{copy.addDialogDescription}</DialogDescription>
        </DialogHeader>

        <AddNewClientForm setCreateModalOpen={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}
