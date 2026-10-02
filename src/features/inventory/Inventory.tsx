import { useState } from "react";
import { AlertTriangle, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { InventoryStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import { ErrorState, NoInventory, NoSearchResults } from "../../ui/EmptyState";
import { cn } from "../../lib/utils";
import { useDebounce } from "../../hooks/useDebounce";
import type { InventoryItem, InventoryListFilter, InventorySort, InventorySortField } from "../../lib/types";
import { useGetInventoryItems } from "./useGetInventoryItems";
import { useGetInventoryItem } from "./useGetInventoryItem";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { formatWorkspaceMoney } from "../../lib/workspaceFormat";
import InventoryDetailPanel from "./InventoryDetailPanel";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { AddInventoryItemDialog } from "./AddInventoryItemDialog";
import { EditInventoryItemDialog } from "./EditInventoryItemDialog";
import { DeleteInventoryItemDialog } from "./DeleteInventoryItemDialog";
import { quantityClass } from "./inventoryDisplay";

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

export function Inventory() {
  const { workspaceId } = useActiveWorkspaceId();
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<InventoryListFilter>("all");
  const [sortValue, setSortValue] = useState("created_at.desc");
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 400);
  const sortOption = sortOptions.find((option) => option.value === sortValue) ?? sortOptions[5];
  const sort: InventorySort = { field: sortOption.field, ascending: sortOption.ascending };

  const { data: workspace } = useGetWorkspace(workspaceId);
  const { items, isLoading, isError, refetch } = useGetInventoryItems(debouncedSearch, stockFilter, sort);
  const detailQuery = useGetInventoryItem(detailId);
  const hasSearchOrFilter = Boolean(debouncedSearch) || stockFilter !== "all";
  const lowStockCount = items.filter((item) => item.stockStatus === "low_stock").length;
  const outOfStockCount = items.filter((item) => item.stockStatus === "out_of_stock").length;

  const columns: Column<InventoryItem>[] = [
    {
      key: "name",
      header: "Name",
      cell: (item) => (
        <div className="flex max-w-[13rem] min-w-0 items-center gap-2 xl:max-w-[14rem] 2xl:max-w-[18rem]">
          <p className="truncate font-medium text-foreground" title={item.name}>{item.name}</p>
          {!item.isActive && <StatusBadge variant="muted">Inactive</StatusBadge>}
        </div>
      ),
    },
    {
      key: "sku",
      header: "SKU",
      cell: (item) => <span className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</span>,
      className: "hidden sm:table-cell whitespace-nowrap",
    },
    {
      key: "category",
      header: "Category",
      cell: (item) => <span className="block max-w-[10rem] truncate text-muted-foreground" title={item.category}>{item.category || "—"}</span>,
      className: "hidden xl:table-cell",
    },
    {
      key: "quantity",
      header: "Quantity",
      cell: (item) => (
        <span className={cn("tabular-nums", quantityClass(item))}>
          {item.quantity} {item.unit}
        </span>
      ),
      className: "text-right whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (item) => <InventoryStatusBadge status={item.stockStatus} />,
    },
    {
      key: "unit",
      header: "Unit",
      cell: (item) => <span className="text-muted-foreground">{item.unit}</span>,
      className: "hidden 2xl:table-cell",
    },
    {
      key: "purchasePrice",
      header: "Purchase Price",
      cell: (item) => <span className="tabular-nums text-muted-foreground">{formatWorkspaceMoney(item.purchasePrice, workspace?.currency)}</span>,
      className: "hidden 2xl:table-cell text-right whitespace-nowrap",
    },
    {
      key: "sellingPrice",
      header: "Selling Price",
      cell: (item) => <span className="font-medium tabular-nums">{formatWorkspaceMoney(item.sellingPrice, workspace?.currency)}</span>,
      className: "hidden sm:table-cell text-right whitespace-nowrap",
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[120px] text-right",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
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
            variant="ghost"
            size="icon-sm"
            className="hover:bg-destructive/10 hover:text-destructive"
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description={isLoading ? "Loading inventory..." : isError ? "Inventory could not be loaded" : `${items.length} ${items.length === 1 ? "item" : "items"}`}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Add Item
          </Button>
        }
      />

      {!isLoading && !isError && (lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {lowStockCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-[13px] font-medium text-warning">
              <AlertTriangle aria-hidden="true" className="size-4" />
              {lowStockCount} items low on stock
            </div>
          )}
          {outOfStockCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">
              <Package aria-hidden="true" className="size-4" />
              {outOfStockCount} items out of stock
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchAndFilters
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by name, SKU, category, supplier, or location..."
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
          <SelectTrigger className="h-9 w-full text-[13px] sm:w-48" aria-label="Sort inventory">
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
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <ErrorState title="Could not load inventory" description="Refresh the list to try again." onRetry={() => refetch()} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          keyExtractor={(item) => item.id}
          onRowClick={(item) => setDetailId(item.id)}
          rowClassName={(item) =>
            item.stockStatus === "out_of_stock" ? "bg-destructive/[0.035]" : item.stockStatus === "low_stock" ? "bg-warning/[0.045]" : undefined
          }
          emptyState={hasSearchOrFilter ? <NoSearchResults query={searchQuery || stockFilters.find((option) => option.value === stockFilter)?.label || stockFilter} /> : <NoInventory onAddItem={() => setCreateOpen(true)} />}
        />
      )}

      <AddInventoryItemDialog open={createOpen} onOpenChange={setCreateOpen} />

      <EditInventoryItemDialog itemId={editId} onClose={() => setEditId(null)} />

      <DeleteInventoryItemDialog
        item={itemToDelete}
        onClose={() => setItemToDelete(null)}
        onDeleted={(itemId) => setDetailId((current) => (current === itemId ? null : current))}
      />

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
