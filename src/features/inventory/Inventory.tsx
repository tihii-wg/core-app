import { useState } from "react";
import { AlertTriangle, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { InventoryStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import { EmptyState, NoInventory, NoSearchResults } from "../../ui/EmptyState";
import { useDebounce } from "../../hooks/useDebounce";
import type { InventoryItem, InventoryListFilter, InventorySort, InventorySortField } from "../../lib/types";
import { useGetInventoryItems } from "./useGetInventoryItems";
import { useGetInventoryItem } from "./useGetInventoryItem";
import { useGetInventoryMarkup, useUpdateInventoryMarkup } from "../workspaces/useInventoryMarkup";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { formatWorkspaceMoney } from "../../lib/workspaceFormat";
import { useCreateInventoryItem } from "./useCreateInventoryItem";
import { useUpdateInventoryItem } from "./useUpdateInventoryItem";
import { useDeleteInventoryItem } from "./useDeleteInventoryItem";
import InventoryItemForm from "./InventoryItemForm";
import InventoryDetailPanel from "./InventoryDetailPanel";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import { useCreateDialogFromNavigation } from "../../hooks/useCreateDialogFromNavigation";

const emptyInventoryForm = {
  name: "",
  sku: "",
  description: "",
  category: "",
  quantity: 0,
  minQuantity: 0,
  unit: "pcs",
  purchasePrice: null,
  sellingPrice: null,
  supplier: "",
  location: "",
  isActive: true,
};

const stockFilters = [
  { value: "all", label: "All" },
  { value: "in_stock", label: "In Stock" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
  { value: "inactive", label: "Inactive" },
];

const sortOptions: { value: string; label: string; field: InventorySortField; ascending: boolean }[] = [
  { value: "name.asc", label: "Name", field: "name", ascending: true },
  { value: "sku.asc", label: "SKU", field: "sku", ascending: true },
  { value: "quantity.desc", label: "Quantity", field: "quantity", ascending: false },
  { value: "purchase_price.desc", label: "Purchase Price", field: "purchase_price", ascending: false },
  { value: "selling_price.desc", label: "Selling Price", field: "selling_price", ascending: false },
  { value: "created_at.desc", label: "Created Date", field: "created_at", ascending: false },
  { value: "updated_at.desc", label: "Updated Date", field: "updated_at", ascending: false },
];

function quantityClass(item: InventoryItem) {
  if (item.stockStatus === "out_of_stock") return "text-[#f41f20] font-medium";
  if (item.stockStatus === "low_stock") return "text-[#f89200] font-medium";
  return "text-[#282e33]";
}

export function Inventory() {
  const { workspaceId } = useActiveWorkspaceId();
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<InventoryListFilter>("all");
  const [sortValue, setSortValue] = useState("created_at.desc");
  const [createOpen, setCreateOpen] = useCreateDialogFromNavigation();
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 400);
  const sortOption = sortOptions.find((option) => option.value === sortValue) ?? sortOptions[5];
  const sort: InventorySort = { field: sortOption.field, ascending: sortOption.ascending };

  const { data: workspace } = useGetWorkspace(workspaceId);
  const { items, isLoading, isError, refetch } = useGetInventoryItems(debouncedSearch, stockFilter, sort);
  const { data: markupPercent = 0, isLoading: markupLoading } = useGetInventoryMarkup(workspaceId);
  const { mutate: saveMarkup } = useUpdateInventoryMarkup();
  // The markup is stored on the workspace, which only the owner can update.
  const canSaveMarkup = canManageWorkspace(workspace?.role);
  const commitMarkup = (nextMarkup: number) => {
    if (!workspaceId || !canSaveMarkup || nextMarkup === markupPercent) return;
    saveMarkup({ workspaceId, markupPercent: nextMarkup });
  };
  const detailQuery = useGetInventoryItem(detailId);
  const editQuery = useGetInventoryItem(editId);
  const { mutate: createItem, isPending: isCreating } = useCreateInventoryItem();
  const { mutate: updateItem, isPending: isUpdating } = useUpdateInventoryItem();
  const { mutate: deleteItem, isPending: isDeleting } = useDeleteInventoryItem();

  const hasSearchOrFilter = Boolean(debouncedSearch) || stockFilter !== "all";
  const lowStockCount = items.filter((item) => item.stockStatus === "low_stock").length;
  const outOfStockCount = items.filter((item) => item.stockStatus === "out_of_stock").length;

  const columns: Column<InventoryItem>[] = [
    {
      key: "name",
      header: "Name",
      cell: (item) => (
        <div>
          <p className="font-medium text-[#282e33]">{item.name}</p>
          {!item.isActive && <StatusBadge variant="muted">Inactive</StatusBadge>}
        </div>
      ),
    },
    {
      key: "sku",
      header: "SKU",
      cell: (item) => <span className="font-mono text-sm text-[#939699]">{item.sku || "—"}</span>,
      className: "hidden sm:table-cell",
    },
    {
      key: "category",
      header: "Category",
      cell: (item) => item.category || "—",
      className: "hidden md:table-cell",
    },
    {
      key: "quantity",
      header: "Quantity",
      cell: (item) => (
        <span className={quantityClass(item)}>
          {item.quantity} {item.unit}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (item) => <InventoryStatusBadge status={item.stockStatus} />,
    },
    {
      key: "unit",
      header: "Unit",
      cell: (item) => item.unit,
      className: "hidden lg:table-cell",
    },
    {
      key: "purchasePrice",
      header: "Purchase Price",
      cell: (item) => formatWorkspaceMoney(item.purchasePrice, workspace?.currency),
      className: "hidden md:table-cell text-right",
    },
    {
      key: "sellingPrice",
      header: "Selling Price",
      cell: (item) => formatWorkspaceMoney(item.sellingPrice, workspace?.currency),
      className: "hidden sm:table-cell text-right",
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[120px] text-right",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Edit ${item.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setEditId(item.id);
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Delete ${item.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setItemToDelete(item);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  const editDefaults = editQuery.item
    ? {
        name: editQuery.item.name,
        sku: editQuery.item.sku,
        description: editQuery.item.description,
        category: editQuery.item.category,
        quantity: editQuery.item.quantity,
        minQuantity: editQuery.item.minQuantity,
        unit: editQuery.item.unit,
        purchasePrice: editQuery.item.purchasePrice,
        sellingPrice: editQuery.item.sellingPrice,
        supplier: editQuery.item.supplier,
        location: editQuery.item.location,
        isActive: editQuery.item.isActive,
      }
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description={isLoading ? "Loading inventory..." : isError ? "Inventory could not be loaded" : `${items.length} ${items.length === 1 ? "item" : "items"}`}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        }
      />

      {!isLoading && !isError && (lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {lowStockCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#fff4e5] text-[#f89200] rounded-md text-sm">
              <AlertTriangle className="h-4 w-4" />
              {lowStockCount} items low on stock
            </div>
          )}
          {outOfStockCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#fee7e7] text-[#f41f20] rounded-md text-sm">
              <Package className="h-4 w-4" />
              {outOfStockCount} items out of stock
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchAndFilters
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by name, SKU, category, or supplier..."
          filters={[
            {
              key: "stock",
              label: "Stock",
              options: stockFilters,
              value: stockFilter,
              onChange: (value) => setStockFilter(value as InventoryListFilter),
            },
          ]}
          onClearFilters={() => {
            setSearchQuery("");
            setStockFilter("all");
          }}
        />
        <Select value={sortValue} onValueChange={setSortValue}>
          <SelectTrigger className="h-9 w-full sm:w-48 border-[#c9cbcc] text-sm" aria-label="Sort inventory">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <div className="bg-white rounded-md border border-[#eeeeef]">
          <EmptyState icon={Package} title="Could not load inventory" description="Refresh the list to try again." action={{ label: "Try again", onClick: () => refetch() }} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          keyExtractor={(item) => item.id}
          onRowClick={(item) => setDetailId(item.id)}
          emptyState={hasSearchOrFilter ? <NoSearchResults query={searchQuery || stockFilters.find((option) => option.value === stockFilter)?.label || stockFilter} /> : <NoInventory onAddItem={() => setCreateOpen(true)} />}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Inventory Item</DialogTitle>
            <DialogDescription className="sr-only">Create an inventory item for the current workspace.</DialogDescription>
          </DialogHeader>
          {markupLoading ? (
            <p className="text-sm text-[#939699]">Loading item...</p>
          ) : (
          <InventoryItemForm
            defaultValues={emptyInventoryForm}
            markupPercent={markupPercent}
            submitLabel="Add Item"
            isSubmitting={isCreating}
            onCancel={() => setCreateOpen(false)}
            onMarkupCommit={commitMarkup}
            onSubmit={(data) => {
              createItem(data, {
                onSuccess: () => setCreateOpen(false),
              });
            }}
          />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editId)}
        onOpenChange={(open) => {
          if (!open) setEditId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription className="sr-only">Update the selected inventory item.</DialogDescription>
          </DialogHeader>
          {editQuery.isLoading && <p className="text-sm text-[#939699]">Loading item...</p>}
          {editQuery.isError && (
            <EmptyState title="Could not load inventory" description="Refresh the item to try again." action={{ label: "Try again", onClick: () => editQuery.refetch() }} />
          )}
          {editDefaults && editQuery.item && !markupLoading && (
            <InventoryItemForm
              key={editQuery.item.id}
              defaultValues={editDefaults}
              markupPercent={markupPercent}
              submitLabel="Save Changes"
              isSubmitting={isUpdating}
              onCancel={() => setEditId(null)}
              onMarkupCommit={commitMarkup}
              onSubmit={(data) => {
                if (!editQuery.item) return;
                updateItem(
                  { id: editQuery.item.id, ...data },
                  {
                    onSuccess: () => setEditId(null),
                  },
                );
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(itemToDelete)}
        onOpenChange={(open) => {
          if (!open) setItemToDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete inventory item?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-[#939699]">
            Delete <strong className="text-[#282e33]">{itemToDelete?.name}</strong>?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setItemToDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => {
                if (!itemToDelete) return;
                deleteItem(itemToDelete.id, {
                  onSuccess: () => {
                    if (detailId === itemToDelete.id) setDetailId(null);
                    setItemToDelete(null);
                  },
                });
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <InventoryDetailPanel
        item={detailQuery.item}
        open={Boolean(detailId)}
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onRetry={() => detailQuery.refetch()}
        onEdit={() => {
          if (!detailId) return;
          setEditId(detailId);
          setDetailId(null);
        }}
        onDelete={() => {
          if (!detailQuery.item) return;
          setItemToDelete(detailQuery.item);
          setDetailId(null);
        }}
      />
    </div>
  );
}
