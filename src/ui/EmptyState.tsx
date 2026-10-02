import { cn } from "../lib/utils";
import type { LucideIcon } from "lucide-react";
import { SearchX, Package, FileText, Users, AlertTriangle, RotateCw, Plus } from "lucide-react";
import { Button } from "../ui/Button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon = SearchX, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-card shadow-xs">
        <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p>}
      {action && (
        <Button onClick={action.onClick} size="sm" className="mt-5">
          <Plus />
          {action.label}
        </Button>
      )}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Check your connection and try again.",
  onRetry,
  isRetrying,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden="true" className="size-5" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry} loading={isRetrying}>
          {!isRetrying && <RotateCw />}
          Try again
        </Button>
      )}
    </div>
  );
}

// Preset empty states
export function NoSearchResults({ query }: { query: string }) {
  return <EmptyState icon={SearchX} title="No results found" description={`No items match "${query}". Try adjusting your search or filters.`} />;
}

export function NoOrders({ onCreateOrder }: { onCreateOrder: () => void }) {
  return <EmptyState icon={FileText} title="No orders yet" description="Get started by creating your first order." action={{ label: "Create Order", onClick: onCreateOrder }} />;
}

export function NoClients({ onAddClient }: { onAddClient: () => void }) {
  return <EmptyState icon={Users} title="No clients yet" description="Start building your client list by adding your first client." action={{ label: "Add Client", onClick: onAddClient }} />;
}
export function NoServices({ onAddService }: { onAddService?: () => void }) {
  return <EmptyState icon={Package} title="No services yet" description="Start building your service list by adding your first service." action={onAddService ? { label: "Add Service", onClick: onAddService } : undefined} />;
}

export function NoInventory({ onAddItem }: { onAddItem: () => void }) {
  return <EmptyState icon={Package} title="No inventory items yet" description="Add your first inventory item to start tracking stock." action={{ label: "Add Inventory Item", onClick: onAddItem }} />;
}

export function NoEmployees({ onAddClient }: { onAddClient: () => void }) {
  return <EmptyState icon={Users} title="No employees yet" description="Start building your team by adding your first employee." action={{ label: "Add Employee", onClick: onAddClient }} />;
}
