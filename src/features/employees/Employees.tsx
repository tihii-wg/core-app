import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, UserRoundX } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
import type { Employee, EmployeeRole } from "../../lib/types";
import AddNewEmployeesForm from "./AddNewEmployeesForm";
import EmployeeDetailPanel from "./EmployeeDetailPanel";
import useGetEmployees from "./useGetEmployees";
import { useDebounce } from "../../hooks/useDebounce";
import { ErrorState, NoEmployees, NoSearchResults } from "../../ui/EmptyState";
import { useGetOrders } from "../orders/useGetOrders";
import { localDateKey } from "../../pages/dashboardStats";
import { teamWorkloadSummary, type EmployeeWorkloadCounts } from "./employeeWorkload";
import { cn } from "../../lib/utils";
import { Skeleton } from "../../ui/Skeleton";

const roleVariants: Record<EmployeeRole, "info" | "violet" | "default" | "warning"> = {
  admin: "violet",
  manager: "info",
  technician: "default",
  receptionist: "warning",
};

const emptyWorkload: EmployeeWorkloadCounts = { open: 0, overdue: 0 };
const emptyEmployees: Employee[] = [];

export function Employees() {
  const { t } = useTranslation();
  const roleLabels: Record<EmployeeRole, string> = {
    admin: t("employees.roles.admin"),
    manager: t("employees.roles.manager"),
    technician: t("employees.roles.technician"),
    receptionist: t("employees.roles.receptionist"),
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<EmployeeRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const debouncedSearch = useDebounce(searchQuery, 400);
  const { employees, isLoading, isPending, error, refetch } = useGetEmployees(debouncedSearch, roleFilter === "all" ? null : roleFilter);
  const { orders, isLoading: ordersLoading, error: ordersError } = useGetOrders();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  const today = localDateKey(new Date());
  const roster = employees ?? emptyEmployees;
  const workload = useMemo(() => teamWorkloadSummary(orders, roster, today), [orders, roster, today]);

  const visibleEmployees = useMemo(() => {
    if (statusFilter === "all") return roster;
    return roster.filter((employee) => employee.status === statusFilter);
  }, [roster, statusFilter]);

  const selectedWorkload = selectedEmployee
    ? (workload.byEmployeeId.get(selectedEmployee.id) ?? emptyWorkload)
    : emptyWorkload;

  const hasActiveFilters = Boolean(searchQuery) || roleFilter !== "all" || statusFilter !== "all";
  const workloadReady = !ordersLoading && !ordersError;
  const showUnassignedSummary = workloadReady && (workload.unassigned.open > 0 || workload.unassigned.overdue > 0);
  const showNoAssignedWork =
    workloadReady && roster.length > 0 && workload.assignedOpen === 0 && workload.unassigned.open === 0;

  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: t("employees.columns.name"),
      cell: (emp) => {
        const inactive = emp.status === "inactive";
        return (
          <div className="flex max-w-[20rem] min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                inactive ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
              )}
            >
              {emp.name.charAt(0)}
            </span>
            <div className="min-w-0">
              <p className={cn("truncate font-medium", inactive ? "text-muted-foreground" : "text-foreground")} title={emp.name}>
                {emp.name}
              </p>
              {emp.email ? (
                <p className="truncate text-xs text-muted-foreground" title={emp.email}>
                  {emp.email}
                </p>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (emp) =>
        emp.status === "active" ? (
          <StatusBadge variant="success" dot>
            {t("employees.statuses.active")}
          </StatusBadge>
        ) : (
          <StatusBadge variant="muted" dot>
            {t("employees.statuses.inactive")}
          </StatusBadge>
        ),
    },
    {
      key: "role",
      header: t("employees.columns.role"),
      cell: (emp) => <StatusBadge variant={roleVariants[emp.role] ?? "default"}>{roleLabels[emp.role]}</StatusBadge>,
      className: "hidden sm:table-cell",
    },
    {
      key: "open",
      header: t("employees.columns.openOrders"),
      cell: (emp) => {
        if (ordersLoading) return <Skeleton className="ml-auto h-4 w-8" />;
        if (ordersError) return <span className="text-muted-foreground">—</span>;
        const counts = workload.byEmployeeId.get(emp.id) ?? emptyWorkload;
        return <span className="font-medium text-foreground tabular-nums">{counts.open}</span>;
      },
      className: "text-right whitespace-nowrap",
    },
    {
      key: "overdue",
      header: t("employees.columns.overdueOrders"),
      cell: (emp) => {
        if (ordersLoading) return <Skeleton className="ml-auto h-4 w-8" />;
        if (ordersError) return <span className="text-muted-foreground">—</span>;
        const counts = workload.byEmployeeId.get(emp.id) ?? emptyWorkload;
        return (
          <span className={cn("tabular-nums", counts.overdue > 0 ? "font-medium text-destructive" : "text-foreground")}>
            {counts.overdue}
          </span>
        );
      },
      className: "hidden md:table-cell text-right whitespace-nowrap",
    },
  ];

  const handleRowClick = (emp: Employee) => {
    setSelectedEmployee(emp);
    setDetailPanelOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("employees.title")}
        description={isPending ? t("employees.loading") : t("employees.memberCount", { count: roster.length })}
        actions={
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus />
            {t("employees.addEmployee")}
          </Button>
        }
      />

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t("employees.searchPlaceholder")}
        filters={[
          {
            key: "role",
            label: t("employees.filters.role"),
            options: [
              { value: "all", label: t("employees.filters.allRoles") },
              { value: "admin", label: roleLabels.admin },
              { value: "manager", label: roleLabels.manager },
              { value: "technician", label: roleLabels.technician },
              { value: "receptionist", label: roleLabels.receptionist },
            ],
            value: roleFilter,
            onChange: (value) => setRoleFilter(value as EmployeeRole | "all"),
          },
          {
            key: "status",
            label: t("employees.filters.status"),
            options: [
              { value: "all", label: t("employees.filters.allStatuses") },
              { value: "active", label: t("employees.statuses.active") },
              { value: "inactive", label: t("employees.statuses.inactive") },
            ],
            value: statusFilter,
            onChange: (value) => setStatusFilter(value as "all" | "active" | "inactive"),
          },
        ]}
        onClearFilters={() => {
          setSearchQuery("");
          setRoleFilter("all");
          setStatusFilter("all");
        }}
      />

      {showUnassignedSummary ? (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
            <UserRoundX aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{t("employees.workload.unassignedTitle")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("employees.workload.unassignedHint")}</p>
          </div>
          <div className="flex gap-4 text-sm tabular-nums">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t("employees.workload.open")}</p>
              <p className="font-semibold text-foreground">{workload.unassigned.open}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t("employees.workload.overdue")}</p>
              <p className={cn("font-semibold", workload.unassigned.overdue > 0 ? "text-destructive" : "text-foreground")}>
                {workload.unassigned.overdue}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {showNoAssignedWork ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {t("employees.workload.noneAssigned")}
        </p>
      ) : null}

      {ordersError ? (
        <p className="text-sm text-destructive">{t("employees.workload.loadError")}</p>
      ) : null}

      <DataTable
        columns={columns}
        isLoading={isLoading}
        data={visibleEmployees}
        emptyState={
          error ? (
            <ErrorState title={t("employees.loadError")} description={error.message} onRetry={() => refetch()} />
          ) : hasActiveFilters ? (
            <NoSearchResults query={searchQuery || t("employees.filters.activeFiltersFallback")} />
          ) : (
            <NoEmployees onAddClient={() => setCreateModalOpen(true)} />
          )
        }
        keyExtractor={(emp) => emp.id}
        onRowClick={handleRowClick}
        rowClassName={(emp) => (emp.status === "inactive" ? "bg-muted/20" : undefined)}
      />

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("employees.dialogs.createTitle")}</DialogTitle>
            <DialogDescription>{t("employees.dialogs.createDescription")}</DialogDescription>
          </DialogHeader>
          <AddNewEmployeesForm setCreateModalOpen={setCreateModalOpen} />
        </DialogContent>
      </Dialog>

      <EmployeeDetailPanel
        detailPanelOpen={detailPanelOpen}
        setDetailPanelOpen={setDetailPanelOpen}
        selectedEmployee={selectedEmployee}
        roleLabels={roleLabels}
        workload={selectedWorkload}
      />
    </div>
  );
}
