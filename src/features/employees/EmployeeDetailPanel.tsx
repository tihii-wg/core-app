import { Mail, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { StatusBadge } from "../../ui/StatusBadge";

export default function EmployeeDetailPanel({ detailPanelOpen, setDetailPanelOpen, selectedEmployee,roleLabels }) {
  return (
    <Sheet open={detailPanelOpen} onOpenChange={setDetailPanelOpen}>
      <SheetContent className="w-full sm:max-w-lg ">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <div className="h-10 w-10 bg-[#1973e1] rounded-full flex items-center justify-center">
              <span className="text-white text-lg font-medium">{selectedEmployee?.name.charAt(0)}</span>
            </div>
            {selectedEmployee?.name}
          </SheetTitle>
        </SheetHeader>

        {selectedEmployee && (
          <div className="mt-6 space-y-6 mx-3">
            {/* Role & Status */}
            <div className="flex items-center gap-2">
              <StatusBadge variant="info">{roleLabels[selectedEmployee.role]}</StatusBadge>
              {selectedEmployee.status === "active" ? <StatusBadge variant="success">Active</StatusBadge> : <StatusBadge variant="muted">Inactive</StatusBadge>}
            </div>

            {/* Contact Info */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[#939699]">Contact Information</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[#939699]" />
                  <a href={`mailto:${selectedEmployee.email}`} className="text-[#1973e1] hover:underline">
                    {selectedEmployee.email}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-[#939699]" />
                  <span className="text-[#282e33]">{selectedEmployee.phone}</span>
                </div>
              </div>
            </div>

            {/* Task Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#f8f9fa] rounded-md p-4">
                <p className="text-sm text-[#939699]">Assigned Tasks</p>
                <p className="text-2xl font-semibold text-[#282e33]">{selectedEmployee.assignedTasks}</p>
              </div>
              <div className="bg-[#f8f9fa] rounded-md p-4">
                <p className="text-sm text-[#939699]">Completed Tasks</p>
                <p className="text-2xl font-semibold text-[#099b49]">{selectedEmployee.completedTasks}</p>
              </div>
            </div>

            {/* Workload visualization */}
            <div>
              <h3 className="text-sm font-medium text-[#939699] mb-3">Current Workload</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#282e33]">Active tasks</span>
                  <span className="font-medium">{selectedEmployee.assignedTasks}</span>
                </div>
                <div className="h-2 bg-[#eeeeef] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#1973e1] rounded-full"
                    style={{
                      width: `${Math.min((selectedEmployee.assignedTasks / 15) * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-[#939699]">{selectedEmployee.assignedTasks > 10 ? "Heavy workload" : selectedEmployee.assignedTasks > 5 ? "Moderate workload" : "Light workload"}</p>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
