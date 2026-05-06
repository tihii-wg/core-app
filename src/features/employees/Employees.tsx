

import { useState, useMemo } from "react";
import { Plus, Mail, Phone, CheckCircle, XCircle } from "lucide-react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/Select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../ui/Sheet";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
import { Spinner } from "../../ui/Spinner";
import { useApp } from "../../lib/app-context";
import type { Employee, EmployeeRole } from "../../lib/types";

const roleLabels: Record<EmployeeRole, string> = {
  admin: "Admin",
  manager: "Manager",
  technician: "Technician",
  receptionist: "Receptionist",
};

export function Employees() {
  const { employees, addEmployee } = useApp();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null
  );

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "" as EmployeeRole | "",
    status: "active" as "active" | "inactive",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtered data
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchesSearch =
        !searchQuery ||
        emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.email.toLowerCase().includes(searchQuery.toLowerCase());
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
          <div className="h-8 w-8 bg-[#1973e1] rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-medium">
              {emp.name.charAt(0)}
            </span>
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
      cell: (emp) => (
        <StatusBadge variant="info">{roleLabels[emp.role]}</StatusBadge>
      ),
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
      cell: (emp) => (
        <span className="text-[#282e33]">{emp.completedTasks}</span>
      ),
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

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.email.trim()) errors.email = "Email is required";
    if (!formData.phone.trim()) errors.phone = "Phone is required";
    if (!formData.role) errors.role = "Role is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateEmployee = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    addEmployee({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      role: formData.role as EmployeeRole,
      status: formData.status,
    });

    setIsSubmitting(false);
    setCreateModalOpen(false);
    setFormData({ name: "", email: "", phone: "", role: "", status: "active" });
  };

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
          <Button
            onClick={() => setCreateModalOpen(true)}
            className="bg-[#1973e1] hover:bg-[#1565c0] text-white"
          >
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

      <DataTable
        columns={columns}
        data={filteredEmployees}
        keyExtractor={(emp) => emp.id}
        onRowClick={handleRowClick}
      />

      {/* Create Employee Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Employee name"
                className={formErrors.name ? "border-[#f41f20]" : ""}
              />
              {formErrors.name && (
                <p className="text-xs text-[#f41f20]">{formErrors.name}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="email@company.com"
                  className={formErrors.email ? "border-[#f41f20]" : ""}
                />
                {formErrors.email && (
                  <p className="text-xs text-[#f41f20]">{formErrors.email}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Phone *</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder="+1 (555) 000-0000"
                  className={formErrors.phone ? "border-[#f41f20]" : ""}
                />
                {formErrors.phone && (
                  <p className="text-xs text-[#f41f20]">{formErrors.phone}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) =>
                    setFormData({ ...formData, role: value as EmployeeRole })
                  }
                >
                  <SelectTrigger
                    className={formErrors.role ? "border-[#f41f20]" : ""}
                  >
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="technician">Technician</SelectItem>
                    <SelectItem value="receptionist">Receptionist</SelectItem>
                  </SelectContent>
                </Select>
                {formErrors.role && (
                  <p className="text-xs text-[#f41f20]">{formErrors.role}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      status: value as "active" | "inactive",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCreateModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateEmployee}
              disabled={isSubmitting}
              className="bg-[#1973e1] hover:bg-[#1565c0] text-white"
            >
              {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Employee"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Employee Detail Panel */}
      <Sheet open={detailPanelOpen} onOpenChange={setDetailPanelOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <div className="h-10 w-10 bg-[#1973e1] rounded-full flex items-center justify-center">
                <span className="text-white text-lg font-medium">
                  {selectedEmployee?.name.charAt(0)}
                </span>
              </div>
              {selectedEmployee?.name}
            </SheetTitle>
          </SheetHeader>

          {selectedEmployee && (
            <div className="mt-6 space-y-6">
              {/* Role & Status */}
              <div className="flex items-center gap-2">
                <StatusBadge variant="info">
                  {roleLabels[selectedEmployee.role]}
                </StatusBadge>
                {selectedEmployee.status === "active" ? (
                  <StatusBadge variant="success">Active</StatusBadge>
                ) : (
                  <StatusBadge variant="muted">Inactive</StatusBadge>
                )}
              </div>

              {/* Contact Info */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-[#939699]">
                  Contact Information
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-[#939699]" />
                    <a
                      href={`mailto:${selectedEmployee.email}`}
                      className="text-[#1973e1] hover:underline"
                    >
                      {selectedEmployee.email}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-[#939699]" />
                    <span className="text-[#282e33]">
                      {selectedEmployee.phone}
                    </span>
                  </div>
                </div>
              </div>

              {/* Task Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#f8f9fa] rounded-md p-4">
                  <p className="text-sm text-[#939699]">Assigned Tasks</p>
                  <p className="text-2xl font-semibold text-[#282e33]">
                    {selectedEmployee.assignedTasks}
                  </p>
                </div>
                <div className="bg-[#f8f9fa] rounded-md p-4">
                  <p className="text-sm text-[#939699]">Completed Tasks</p>
                  <p className="text-2xl font-semibold text-[#099b49]">
                    {selectedEmployee.completedTasks}
                  </p>
                </div>
              </div>

              {/* Workload visualization */}
              <div>
                <h3 className="text-sm font-medium text-[#939699] mb-3">
                  Current Workload
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#282e33]">Active tasks</span>
                    <span className="font-medium">
                      {selectedEmployee.assignedTasks}
                    </span>
                  </div>
                  <div className="h-2 bg-[#eeeeef] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#1973e1] rounded-full"
                      style={{
                        width: `${Math.min(
                          (selectedEmployee.assignedTasks / 15) * 100,
                          100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-[#939699]">
                    {selectedEmployee.assignedTasks > 10
                      ? "Heavy workload"
                      : selectedEmployee.assignedTasks > 5
                      ? "Moderate workload"
                      : "Light workload"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
