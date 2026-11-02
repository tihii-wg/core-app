import { useState } from "react";
import { Mail, Pencil, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Employee, EmployeeRole } from "../../lib/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { StatusBadge } from "../../ui/StatusBadge";
import { Button } from "../../ui/Button";
import { cn } from "../../lib/utils";
import type { EmployeeWorkloadCounts } from "./employeeWorkload";
import { DeleteEmployeeDialog } from "./DeleteEmployeeDialog";
import EditEmployeeForm from "./EditEmployeeForm";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";

type EmployeeDetailPanelProps = {
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  selectedEmployee: Employee | null;
  roleLabels: Record<EmployeeRole, string>;
  workload: EmployeeWorkloadCounts;
  onEmployeeUpdated?: (employee: Employee) => void;
  onEmployeeDeleted?: (employeeId: string) => void;
};

export default function EmployeeDetailPanel({
  detailPanelOpen,
  setDetailPanelOpen,
  selectedEmployee,
  roleLabels,
  workload,
  onEmployeeUpdated,
  onEmployeeDeleted,
}: EmployeeDetailPanelProps) {
  const { t } = useTranslation();
  const { canWrite: canMutateEmployees } = useWorkspaceSubscription();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inactive = selectedEmployee?.status === "inactive";

  return (
    <Sheet
      open={detailPanelOpen}
      onOpenChange={(open) => {
        if (!open) setIsEditing(false);
        setDetailPanelOpen(open);
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold",
                inactive ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
              )}
            >
              {selectedEmployee?.name.charAt(0)}
            </span>
            <span className={cn("min-w-0 [overflow-wrap:anywhere]", inactive && "text-muted-foreground")}>
              {selectedEmployee?.name}
            </span>
          </SheetTitle>
          {selectedEmployee && canMutateEmployees && !isEditing ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label={t("employees.editEmployeeLabel", { name: selectedEmployee.name })}
              title={t("employees.editEmployee")}
              className="absolute top-3.5 right-12 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <Pencil className="size-4" />
            </button>
          ) : null}
          <SheetDescription className="sr-only">{t("employees.detail.panelDescription")}</SheetDescription>
        </SheetHeader>

        {selectedEmployee && isEditing ? (
          <div className="px-5 py-5">
            <EditEmployeeForm
              key={selectedEmployee.id}
              employee={selectedEmployee}
              onCancel={() => setIsEditing(false)}
              onUpdated={(employee) => {
                onEmployeeUpdated?.(employee);
                setIsEditing(false);
              }}
            />
          </div>
        ) : null}

        {selectedEmployee && !isEditing && (
          <div className="space-y-6 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge variant="info">{roleLabels[selectedEmployee.role]}</StatusBadge>
              {inactive ? (
                <StatusBadge variant="muted" dot>
                  {t("employees.statuses.inactive")}
                </StatusBadge>
              ) : (
                <StatusBadge variant="success" dot>
                  {t("employees.statuses.active")}
                </StatusBadge>
              )}
            </div>

            {inactive ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("employees.detail.inactiveAssignmentHint")}
              </p>
            ) : null}

            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                {t("employees.detail.contactInformation")}
              </h3>
              <div className="space-y-2 text-sm">
                {selectedEmployee.email ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <Mail className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
                    <a href={`mailto:${selectedEmployee.email}`} className="truncate text-primary hover:underline">
                      {selectedEmployee.email}
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("employees.detail.noEmail")}</p>
                )}
                {selectedEmployee.phone ? (
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
                    <span className="text-foreground tabular-nums">{selectedEmployee.phone}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("employees.detail.noPhone")}</p>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                {t("employees.detail.currentWorkload")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-muted/50 p-4">
                  <p className="text-xs font-medium text-muted-foreground">{t("employees.workload.open")}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{workload.open}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/50 p-4">
                  <p className="text-xs font-medium text-muted-foreground">{t("employees.workload.overdue")}</p>
                  <p
                    className={cn(
                      "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
                      workload.overdue > 0 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {workload.overdue}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t("employees.detail.workloadHint")}</p>
            </div>

            {canMutateEmployees && !inactive ? (
              <div className="flex justify-end border-t border-border pt-4">
                <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                  {t("common.delete")}
                </Button>
              </div>
            ) : null}
          </div>
        )}

        <DeleteEmployeeDialog
          employee={deleteOpen ? selectedEmployee : null}
          onClose={() => setDeleteOpen(false)}
          onDeleted={(employeeId) => {
            onEmployeeDeleted?.(employeeId);
            setDetailPanelOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
