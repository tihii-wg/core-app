import { memo } from "react";
import { EllipsisVertical, Eye, Pencil, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Employee, EmployeeRole } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import { Skeleton } from "../../ui/Skeleton";
import { StatusBadge } from "../../ui/StatusBadge";
import type { EmployeeWorkloadCounts } from "./employeeWorkload";

const roleVariants: Record<EmployeeRole, "info" | "violet" | "default" | "warning"> = {
  admin: "violet",
  manager: "info",
  technician: "default",
  receptionist: "warning",
};

type EmployeeCardProps = {
  employee: Employee;
  roleLabel: string;
  /** null while the orders behind the counters load; undefined when they failed. */
  workload: EmployeeWorkloadCounts | null | undefined;
  onView: (employee: Employee) => void;
  /** Omitted in a read-only workspace. */
  onEdit?: (employee: Employee) => void;
};

/**
 * Compact phone layout for one employee (below the md breakpoint), same look as the client and
 * order cards. The whole surface opens the employee panel; the actions menu is independent.
 * Memoized: it re-renders only when its own data changes.
 */
export const EmployeeCard = memo(function EmployeeCard({ employee, roleLabel, workload, onView, onEdit }: EmployeeCardProps) {
  const { t } = useTranslation();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const inactive = employee.status === "inactive";
  const counter = (value: number | undefined, danger = false) =>
    workload === null ? (
      <Skeleton className="inline-block h-4 w-6 align-middle" />
    ) : workload === undefined ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className={cn("font-medium tabular-nums", danger && (value ?? 0) > 0 ? "text-destructive" : "text-foreground")}>{value}</span>
    );

  return (
    <article
      onClick={() => onView(employee)}
      className={cn(
        "cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 active:bg-accent/60",
        inactive && "bg-muted/20",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
            inactive ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {employee.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold", inactive ? "text-muted-foreground" : "text-foreground")} title={employee.name}>
            {employee.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge variant={roleVariants[employee.role] ?? "default"}>{roleLabel}</StatusBadge>
            {inactive ? (
              <StatusBadge variant="muted" dot>
                {t("employees.statuses.inactive")}
              </StatusBadge>
            ) : null}
          </div>
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-10 shrink-0"
              aria-label={t("employees.editEmployeeLabel", { name: employee.name })}
              onClick={stop}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" onClick={stop}>
            <DropdownMenuItem onSelect={() => onView(employee)}>
              <Eye />
              {t("clients.actions.viewDetails")}
            </DropdownMenuItem>
            {onEdit ? (
              <DropdownMenuItem onSelect={() => onEdit(employee)}>
                <Pencil />
                {t("employees.editEmployee")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {employee.phone ? (
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
          <Phone aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
          <span className="truncate tabular-nums">{employee.phone}</span>
        </p>
      ) : null}

      <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border pt-2.5 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground">{t("employees.workload.open")}</p>
          {counter(workload?.open)}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{t("employees.workload.overdue")}</p>
          {counter(workload?.overdue, true)}
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">{t("employees.workload.closed")}</p>
          {counter(workload?.closed)}
        </div>
      </div>
    </article>
  );
});
