import { Description } from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { Service } from "../../lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { industryServiceCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import AddNewServiceForm from "./AddNewServiceForm";

/**
 * The one "new service" dialog: used on the Services page and from an order's
 * "Services & goods" search, so a service is always created with the same full form.
 */
export default function CreateServiceDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the service name (e.g. what was typed in the order search). */
  initialName?: string;
  /** Called with the saved catalog service (e.g. to add it to the order right away). */
  onCreated?: (service: Service) => void;
}) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const serviceCopy = industryServiceCopy(workflow);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <Description className="sr-only">{serviceCopy.createDescription}</Description>
        <DialogHeader>
          <DialogTitle>{t("services.dialogs.createTitle")}</DialogTitle>
        </DialogHeader>
        {open ? (
          <AddNewServiceForm setCreateModalOpen={onOpenChange} initialName={initialName} onCreated={onCreated} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
