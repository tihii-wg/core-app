import { cn } from "../lib/utils";
import type { LucideIcon } from "lucide-react";
import { SearchX, Package, FileText, Users } from "lucide-react";
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
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <div className="p-3 bg-[#f1f3f5] rounded-full mb-4">
        <Icon className="h-8 w-8 text-[#939699]" />
      </div>
      <h3 className="text-base font-medium text-[#282e33]">{title}</h3>
      {description && <p className="text-sm text-[#939699] mt-1 max-w-sm">{description}</p>}
      {action && (
        <Button onClick={action.onClick} className="mt-4 bg-[#1973e1] hover:bg-[#1565c0] text-white">
          {action.label}
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

export function NoInventory({ onAddItem }: { onAddItem: () => void }) {
  return <EmptyState icon={Package} title="No inventory items" description="Add items to track your inventory." action={{ label: "Add Item", onClick: onAddItem }} />;
}

export function NoEmployees({ onAddClient }: { onAddClient: () => void }) {
  return <EmptyState icon={Users} title="No employes yet" description="Start building your employees list by adding your first employee." action={{ label: "Add Employee", onClick: onAddClient }} />;
}
