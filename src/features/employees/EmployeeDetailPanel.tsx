import { Mail, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Employee, EmployeeRole } from "../../lib/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { StatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import type { EmployeeWorkloadCounts } from "./employeeWorkload";

type EmployeeDetailPanelProps = {
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  selectedEmployee: Employee | null;
  roleLabels: Record<EmployeeRole, string>;
  workload: EmployeeWorkloadCounts;
};

export default function EmployeeDetailPanel({
  detailPanelOpen,
  setDetailPanelOpen,
  selectedEmployee,
  roleLabels,
  workload,
}: EmployeeDetailPanelProps) {
  const { t } = useTranslation();
  const inactive = selectedEmployee?.status === "inactive";

  return (
    <Sheet open={detailPanelOpen} onOpenChange={setDetailPanelOpen}>
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
          <SheetDescription className="sr-only">{t("employees.detail.panelDescription")}</SheetDescription>
        </SheetHeader>

        {selectedEmployee && (
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
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
