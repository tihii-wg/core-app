import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
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
// import FullPageSpinner from "../../ui/FullPageDataSpinner";
import { ErrorState, NoEmployees, NoSearchResults } from "../../ui/EmptyState";

const roleVariants: Record<EmployeeRole, "info" | "violet" | "default" | "warning"> = {
  admin: "violet",
  manager: "info",
  technician: "default",
  receptionist: "warning",
};

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
  const debouncesearch = useDebounce(searchQuery, 400);
  const { employees, isLoading, isPending, error, refetch } = useGetEmployees(debouncesearch, roleFilter === "all" ? null : roleFilter);

  // State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Table columns
  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: t("employees.columns.name"),
      cell: (emp) => (
        <div className="flex max-w-[20rem] min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
            {emp.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground" title={emp.name}>{emp.name}</p>
            {emp.email && <p className="truncate text-xs text-muted-foreground" title={emp.email}>{emp.email}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: t("employees.columns.role"),
      cell: (emp) => <StatusBadge variant={roleVariants[emp.role] ?? "default"}>{roleLabels[emp.role]}</StatusBadge>,
    },
    {
      key: "tasks",
      header: t("employees.columns.tasks"),
      cell: (emp) => (
        <div className="text-[13px]">
          <Trans
            i18nKey="employees.tasksAssigned"
            values={{ value: emp.assignedTasks }}
            components={{ value: <span className="font-medium text-foreground tabular-nums" />, muted: <span className="text-muted-foreground" /> }}
          />
        </div>
      ),
      className: "hidden sm:table-cell whitespace-nowrap",
    },
    {
      key: "completed",
      header: t("employees.columns.completed"),
      cell: (emp) => <span className="text-foreground tabular-nums">{emp.completedTasks}</span>,
      className: "hidden md:table-cell text-right",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (emp) =>
        emp.status === "active" ? (
          <StatusBadge variant="success" dot>{t("employees.statuses.active")}</StatusBadge>
        ) : (
          <StatusBadge variant="muted" dot>{t("employees.statuses.inactive")}</StatusBadge>
        ),
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
        description={isPending ? t("employees.loading") : t("employees.memberCount", { count: employees?.length ?? 0 })}
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
        ]}
        onClearFilters={() => {
          setSearchQuery("");
          setRoleFilter("all");
        }}
      />
      <DataTable
        columns={columns}
        isLoading={isLoading}
        data={employees ?? []}
        emptyState={
          error ? (
            <ErrorState title={t("employees.loadError")} description={error.message} onRetry={() => refetch()} />
          ) : searchQuery ? (
            <NoSearchResults query={searchQuery} />
          ) : (
            <NoEmployees onAddClient={() => setCreateModalOpen(true)} />
          )
        }
        keyExtractor={(emp) => emp.id}
        onRowClick={handleRowClick}
      />
      
    
      {/* {isLoading && <FullPageSpinner />} */}

      {/* Create Employee Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("employees.dialogs.createTitle")}</DialogTitle>
            <DialogDescription>{t("employees.dialogs.createDescription")}</DialogDescription>
          </DialogHeader>
          <AddNewEmployeesForm setCreateModalOpen={setCreateModalOpen} />
        </DialogContent>
      </Dialog>
      {/* Employee Detail Panel */}
      <EmployeeDetailPanel detailPanelOpen={detailPanelOpen} setDetailPanelOpen={setDetailPanelOpen} selectedEmployee={selectedEmployee} roleLabels={roleLabels} />
    </div>
  );
}
