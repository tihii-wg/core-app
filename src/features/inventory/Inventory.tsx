import { useState } from "react";
import { useTranslation } from "react-i18next";
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

type SortLabelKey = "name" | "sku" | "quantity" | "purchasePrice" | "sellingPrice" | "createdAt" | "updatedAt";

const sortOptions: { value: string; labelKey: SortLabelKey; field: InventorySortField; ascending: boolean }[] = [
  { value: "name.asc", labelKey: "name", field: "name", ascending: true },
  { value: "sku.asc", labelKey: "sku", field: "sku", ascending: true },
  { value: "quantity.desc", labelKey: "quantity", field: "quantity", ascending: false },
  { value: "purchase_price.desc", labelKey: "purchasePrice", field: "purchase_price", ascending: false },
  { value: "selling_price.desc", labelKey: "sellingPrice", field: "selling_price", ascending: false },
  { value: "created_at.desc", labelKey: "createdAt", field: "created_at", ascending: false },
  { value: "updated_at.desc", labelKey: "updatedAt", field: "updated_at", ascending: false },
];

export function Inventory() {
  const { t } = useTranslation();
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

  const stockFilters = [
    { value: "all", label: t("common.all") },
    { value: "in_stock", label: t("status.inventory.in_stock") },
    { value: "low_stock", label: t("status.inventory.low_stock") },
    { value: "out_of_stock", label: t("status.inventory.out_of_stock") },
    { value: "inactive", label: t("inventory.inactive") },
  ];

  const columns: Column<InventoryItem>[] = [
    {
      key: "name",
      header: t("inventory.fields.name"),
      cell: (item) => (
        <div className="flex max-w-[13rem] min-w-0 items-center gap-2 xl:max-w-[14rem] 2xl:max-w-[18rem]">
          <p className="truncate font-medium text-foreground" title={item.name}>{item.name}</p>
          {!item.isActive && <StatusBadge variant="muted">{t("inventory.inactive")}</StatusBadge>}
        </div>
      ),
    },
    {
      key: "sku",
      header: t("inventory.fields.sku"),
      cell: (item) => <span className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</span>,
      className: "hidden sm:table-cell whitespace-nowrap",
    },
    {
      key: "category",
      header: t("inventory.fields.category"),
      cell: (item) => <span className="block max-w-[10rem] truncate text-muted-foreground" title={item.category}>{item.category || "—"}</span>,
      className: "hidden xl:table-cell",
    },
    {
      key: "quantity",
      header: t("inventory.fields.quantity"),
      cell: (item) => (
        <span className={cn("tabular-nums", quantityClass(item))}>
          {item.quantity} {item.unit}
        </span>
      ),
      className: "text-right whitespace-nowrap",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (item) => <InventoryStatusBadge status={item.stockStatus} />,
    },
    {
      key: "unit",
      header: t("inventory.fields.unit"),
      cell: (item) => <span className="text-muted-foreground">{item.unit}</span>,
      className: "hidden 2xl:table-cell",
    },
    {
      key: "purchasePrice",
      header: t("inventory.fields.purchasePrice"),
      cell: (item) => <span className="tabular-nums text-muted-foreground">{formatWorkspaceMoney(item.purchasePrice, workspace?.currency)}</span>,
      className: "hidden 2xl:table-cell text-right whitespace-nowrap",
    },
    {
      key: "sellingPrice",
      header: t("inventory.fields.sellingPrice"),
      cell: (item) => <span className="font-medium tabular-nums">{formatWorkspaceMoney(item.sellingPrice, workspace?.currency)}</span>,
      className: "hidden sm:table-cell text-right whitespace-nowrap",
    },
    {
      key: "actions",
      header: t("common.actions"),
      className: "w-[120px] text-right",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("inventory.editAriaLabel", { name: item.name })}
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
            aria-label={t("inventory.deleteAriaLabel", { name: item.name })}
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
        title={t("inventory.title")}
        description={isLoading ? t("inventory.loading") : isError ? t("inventory.loadFailedSummary") : t("inventory.itemCount", { count: items.length })}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("inventory.addItem")}
          </Button>
        }
      />

      {!isLoading && !isError && (lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {lowStockCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-[13px] font-medium text-warning">
              <AlertTriangle aria-hidden="true" className="size-4" />
              {t("inventory.lowStockCount", { count: lowStockCount })}
            </div>
          )}
          {outOfStockCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">
              <Package aria-hidden="true" className="size-4" />
              {t("inventory.outOfStockCount", { count: outOfStockCount })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchAndFilters
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t("inventory.searchPlaceholder")}
          filters={[
            {
              key: "stock",
              label: t("inventory.filters.stock"),
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
          <SelectTrigger className="h-9 w-full text-[13px] sm:w-48" aria-label={t("inventory.sort.ariaLabel")}>
            <SelectValue placeholder={t("inventory.sort.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(`inventory.sort.${option.labelKey}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <ErrorState title={t("inventory.loadError.title")} description={t("inventory.loadError.listDescription")} onRetry={() => refetch()} />
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
