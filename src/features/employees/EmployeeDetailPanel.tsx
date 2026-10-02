import { Mail, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { StatusBadge } from "../../ui/StatusBadge";

export default function EmployeeDetailPanel({ detailPanelOpen, setDetailPanelOpen, selectedEmployee,roleLabels }) {
  return (
    <Sheet open={detailPanelOpen} onOpenChange={setDetailPanelOpen}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
              {selectedEmployee?.name.charAt(0)}
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{selectedEmployee?.name}</span>
          </SheetTitle>
        </SheetHeader>

        {selectedEmployee && (
          <div className="space-y-6 px-5 py-5">
            {/* Role & Status */}
            <div className="flex items-center gap-2">
              <StatusBadge variant="info">{roleLabels[selectedEmployee.role]}</StatusBadge>
              {selectedEmployee.status === "active" ? <StatusBadge variant="success">Active</StatusBadge> : <StatusBadge variant="muted">Inactive</StatusBadge>}
            </div>

            {/* Contact Info */}
            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">Contact Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="size-4 shrink-0 text-subtle-foreground" />
                  <a href={`mailto:${selectedEmployee.email}`} className="truncate text-primary hover:underline">
                    {selectedEmployee.email}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0 text-subtle-foreground" />
                  <span className="text-foreground tabular-nums">{selectedEmployee.phone}</span>
                </div>
              </div>
            </div>

            {/* Task Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <p className="text-xs font-medium text-muted-foreground">Assigned Tasks</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{selectedEmployee.assignedTasks}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <p className="text-xs font-medium text-muted-foreground">Completed Tasks</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-success tabular-nums">{selectedEmployee.completedTasks}</p>
              </div>
            </div>

            {/* Workload visualization */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">Current Workload</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">Active tasks</span>
                  <span className="font-medium">{selectedEmployee.assignedTasks}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{
                      width: `${Math.min((selectedEmployee.assignedTasks / 15) * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{selectedEmployee.assignedTasks > 10 ? "Heavy workload" : selectedEmployee.assignedTasks > 5 ? "Moderate workload" : "Light workload"}</p>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
