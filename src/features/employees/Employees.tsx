import { useState, useMemo } from "react";
import { Plus, CheckCircle, XCircle } from "lucide-react";
import { Button } from "../../ui/Button";
// import { Input } from "../../ui/Input";
// import { Label } from "../../ui/Label";
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
// import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
// import { Spinner } from "../../ui/Spinner";
import { useApp } from "../../lib/appContext";
import type { Employee, EmployeeRole } from "../../lib/types";
import AddNewEmployeesForm from "./AddNewEmployeesForm";
import EmployeeDetailPanel from "./EmployeeDetailPanel";

const roleLabels: Record<EmployeeRole, string> = {
  admin: "Admin",
  manager: "Manager",
  technician: "Technician",
  receptionist: "Receptionist",
};

export function Employees() {
  const { employees } = useApp();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Filtered data
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchesSearch = !searchQuery || emp.name.toLowerCase().includes(searchQuery.toLowerCase()) || emp.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === "all" || emp.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [employees, searchQuery, roleFilter]);

  // Table columns
  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: "Name",
      cell: (emp) => (
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-[#1973e1] rounded-full flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-medium">{emp.name.charAt(0)}</span>
          </div>
          <div>
            <p className="font-medium text-[#282e33]">{emp.name}</p>
            <p className="text-xs text-[#939699]">{emp.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (emp) => <StatusBadge variant="info">{roleLabels[emp.role]}</StatusBadge>,
    },
    {
      key: "tasks",
      header: "Tasks",
      cell: (emp) => (
        <div className="text-sm">
          <span className="text-[#282e33]">{emp.assignedTasks}</span>
          <span className="text-[#939699]"> assigned</span>
        </div>
      ),
      className: "hidden sm:table-cell",
    },
    {
      key: "completed",
      header: "Completed",
      cell: (emp) => <span className="text-[#282e33]">{emp.completedTasks}</span>,
      className: "hidden md:table-cell",
    },
    {
      key: "status",
      header: "Status",
      cell: (emp) => (
        <div className="flex items-center gap-1">
          {emp.status === "active" ? (
            <>
              <CheckCircle className="h-4 w-4 text-[#099b49]" />
              <span className="text-sm text-[#099b49]">Active</span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-[#939699]" />
              <span className="text-sm text-[#939699]">Inactive</span>
            </>
          )}
        </div>
      ),
    },
  ];

  const handleRowClick = (emp: Employee) => {
    setSelectedEmployee(emp);
    setDetailPanelOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employees"
        description={`${employees.length} team members`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
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
            onChange: setRoleFilter,
          },
        ]}
        onClearFilters={() => {
          setSearchQuery("");
          setRoleFilter("all");
        }}
      />

      <DataTable columns={columns} data={filteredEmployees} keyExtractor={(emp) => emp.id} onRowClick={handleRowClick} />

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
