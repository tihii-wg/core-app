import { useState } from "react";
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

const roleLabels: Record<EmployeeRole, string> = {
  admin: "Admin",
  manager: "Manager",
  technician: "Technician",
  receptionist: "Receptionist",
};

const roleVariants: Record<EmployeeRole, "info" | "violet" | "default" | "warning"> = {
  admin: "violet",
  manager: "info",
  technician: "default",
  receptionist: "warning",
};

export function Employees() {
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
      header: "Name",
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
      header: "Role",
      cell: (emp) => <StatusBadge variant={roleVariants[emp.role] ?? "default"}>{roleLabels[emp.role]}</StatusBadge>,
    },
    {
      key: "tasks",
      header: "Tasks",
      cell: (emp) => (
        <div className="text-[13px]">
          <span className="font-medium text-foreground tabular-nums">{emp.assignedTasks}</span>
          <span className="text-muted-foreground"> assigned</span>
        </div>
      ),
      className: "hidden sm:table-cell whitespace-nowrap",
    },
    {
      key: "completed",
      header: "Completed",
      cell: (emp) => <span className="text-foreground tabular-nums">{emp.completedTasks}</span>,
      className: "hidden md:table-cell text-right",
    },
    {
      key: "status",
      header: "Status",
      cell: (emp) =>
        emp.status === "active" ? (
          <StatusBadge variant="success" dot>Active</StatusBadge>
        ) : (
          <StatusBadge variant="muted" dot>Inactive</StatusBadge>
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
        title="Employees"
        description={isPending ? "Loading employees" : `${employees?.length} team members`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus />
            Add Employee
          </Button>
        }
      />
      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search employees..."
        filters={[
          {
            key: "role",
            label: "Role",
            options: [
              { value: "all", label: "All Roles" },
              { value: "admin", label: "Admin" },
              { value: "manager", label: "Manager" },
              { value: "technician", label: "Technician" },
              { value: "receptionist", label: "Receptionist" },
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
            <ErrorState title="Could not load employees" description={error.message} onRetry={() => refetch()} />
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
            <DialogTitle>Add New Employee</DialogTitle>
            <DialogDescription>Fill in the employee information below.</DialogDescription>
          </DialogHeader>
          <AddNewEmployeesForm setCreateModalOpen={setCreateModalOpen} />
        </DialogContent>
      </Dialog>
      {/* Employee Detail Panel */}
      <EmployeeDetailPanel detailPanelOpen={detailPanelOpen} setDetailPanelOpen={setDetailPanelOpen} selectedEmployee={selectedEmployee} roleLabels={roleLabels} />
    </div>
  );
}
