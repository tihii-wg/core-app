import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { InventoryStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import { Spinner } from "../../ui/Spinner";
import type { InventoryItem } from "../../lib/types";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { formatWorkspaceDate, formatWorkspaceMoney } from "../../lib/workspaceFormat";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

type InventoryDetailPanelProps = {
  item: InventoryItem | null;
  open: boolean;
  isLoading: boolean;
  isError: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium [overflow-wrap:anywhere] text-foreground tabular-nums">{value}</span>
    </div>
  );
}

export default function InventoryDetailPanel({ item, open, isLoading, isError, onOpenChange, onEdit, onDelete, onRetry }: InventoryDetailPanelProps) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="[overflow-wrap:anywhere]">{item?.name ?? "Inventory item"}</SheetTitle>
          <SheetDescription className="sr-only">Inventory item details, stock status, and pricing.</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Spinner className="h-5 w-5" />
          </div>
        )}

        {isError && !isLoading && (
          <div role="alert" className="space-y-3 px-5 py-6">
            <p className="text-sm text-foreground">Could not load this inventory item.</p>
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}

        {!isLoading && !isError && !item && open && <p className="px-5 py-6 text-sm text-muted-foreground">Inventory item was not found.</p>}

        {item && !isLoading && (
          <div className="space-y-5 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <InventoryStatusBadge status={item.stockStatus} />
              {item.isActive ? <StatusBadge variant="success">Active</StatusBadge> : <StatusBadge variant="muted">Inactive</StatusBadge>}
            </div>

            <div className="divide-y divide-border border-y border-border">
              <DetailRow label="SKU" value={item.sku || "—"} />
              <DetailRow label="Category" value={item.category || "—"} />
              <DetailRow label="Description" value={item.description || "—"} />
              <DetailRow label="Quantity" value={`${item.quantity} ${item.unit}`} />
              <DetailRow label="Minimum Quantity" value={String(item.minQuantity)} />
              <DetailRow label="Unit" value={item.unit || "—"} />
              <DetailRow label="Purchase Price" value={formatWorkspaceMoney(item.purchasePrice, workspace?.currency)} />
              <DetailRow label="Selling Price" value={formatWorkspaceMoney(item.sellingPrice, workspace?.currency)} />
              <DetailRow label="Supplier" value={item.supplier || "—"} />
              <DetailRow label="Location" value={item.location || "—"} />
              <DetailRow label="Created" value={formatWorkspaceDate(item.createdAt, workspace?.dateFormat, workspace?.timezone)} />
              <DetailRow label="Updated" value={formatWorkspaceDate(item.updatedAt, workspace?.dateFormat, workspace?.timezone)} />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onEdit}>
                Edit
              </Button>
              <Button type="button" variant="destructive" onClick={onDelete}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
