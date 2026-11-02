import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { Employee } from "../../lib/types";
import { useDeleteEmployee } from "./useDeleteEmployee";

type DeleteEmployeeDialogProps = {
  employee: Employee | null;
  onClose: () => void;
  onDeleted?: (employeeId: string) => void;
};

export function DeleteEmployeeDialog({ employee, onClose, onDeleted }: DeleteEmployeeDialogProps) {
  const { t } = useTranslation();
  const { mutate: deleteEmployee, isPending } = useDeleteEmployee();

  return (
    <Dialog
      open={Boolean(employee)}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("employees.delete.title")}</DialogTitle>
          <DialogDescription>{t("employees.delete.description")}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <Trans
            i18nKey="employees.delete.confirm"
            values={{ name: employee?.name }}
            components={{ strong: <strong className="text-foreground" /> }}
          />
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending || !employee}
            onClick={() => {
              if (!employee || isPending) return;
              deleteEmployee(employee.id, {
                onSuccess: () => {
                  onDeleted?.(employee.id);
                  onClose();
                },
              });
            }}
          >
            {isPending ? t("common.deleting") : t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
