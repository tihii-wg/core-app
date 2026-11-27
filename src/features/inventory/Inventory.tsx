import { DialogLauncher, type DialogLauncherHandle } from "../../ui/DialogLauncher";
import { useFormFieldLayout } from "../formFields/useFormFields";
import { useStableCallback } from "../../lib/useStableCallback";
import { useEffect, useMemo, useRef, useState } from "react";
import { useListTopAnchor } from "../../hooks/useListTopAnchor";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Pencil, Plus, Trash2, Warehouse } from "lucide-react";
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
import { useInventoryPage, useStockAttention } from "./useGetInventoryItems";
import { ServerListPager } from "../../ui/ServerListPager";
import { DEFAULT_LIST_PAGE_SIZE, type ListPageSize } from "../../lib/serverPaging";
import { useGetInventorySuppliers } from "./useGetInventorySuppliers";
import { useGetInventoryItem } from "./useGetInventoryItem";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { formatWorkspaceMoney } from "../../lib/workspaceFormat";
import { useIsMobile } from "../../hooks/use-mobile";
import { Skeleton } from "../../ui/Skeleton";
import { InventoryCard } from "./InventoryCard";
import { InventoryPhotoThumb } from "./InventoryPhoto";
import { useInventoryThumbUrls } from "./useInventoryPhotos";
import InventoryDetailPanel from "./InventoryDetailPanel";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { AddInventoryItemDialog } from "./AddInventoryItemDialog";
import { EditInventoryItemDialog } from "./EditInventoryItemDialog";
import { DeleteInventoryItemDialog } from "./DeleteInventoryItemDialog";
import { QuickGoodsReceiptDialog } from "./QuickGoodsReceiptDialog";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { quantityClass } from "./inventoryDisplay";
import { StockAttentionPanel } from "./StockAttentionPanel";
import { CategoriesPanel } from "./CategoriesPanel";
import { effectiveStockStatus } from "./stockStatus";
import { industryInventoryCopy, industryInventoryItemCount } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { languageFromPath } from "../../i18n/languages";
import { Card, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { SupplierLink } from "../suppliers/SupplierLink";

type SortLabelKey = "name" | "sku" | "quantity" | "purchasePrice" | "createdAt" | "updatedAt";

const DEFAULT_SORT_VALUE = "created_at.desc";

const sortOptions: { value: string; labelKey: SortLabelKey; field: InventorySortField; ascending: boolean }[] = [
  { value: "name.asc", labelKey: "name", field: "name", ascending: true },
  { value: "sku.asc", labelKey: "sku", field: "sku", ascending: true },
  { value: "quantity.desc", labelKey: "quantity", field: "quantity", ascending: false },
  { value: "purchase_price.desc", labelKey: "purchasePrice", field: "purchase_price", ascending: false },
  { value: "created_at.desc", labelKey: "createdAt", field: "created_at", ascending: false },
  { value: "updated_at.desc", labelKey: "updatedAt", field: "updated_at", ascending: false },
];

export function Inventory() {
  const { t } = useTranslation();
  const fieldLabels = useFormFieldLayout("product");
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId } = useActiveWorkspaceId();
  const { workflow } = useIndustryWorkflow();
  const inventoryCopy = industryInventoryCopy(workflow);
  const { canWrite: canMutateInventory } = useWorkspaceSubscription();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<InventoryListFilter>("active");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [sortValue, setSortValue] = useState(DEFAULT_SORT_VALUE);
  // Dialog state lives in the launcher: opening it must not re-render the whole parts list.
  const createLauncher = useRef<DialogLauncherHandle>(null);
  const openCreate = () => createLauncher.current?.open();
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
  const [receiveItem, setReceiveItem] = useState<InventoryItem | null>(null);
  const { data: warehouses = [], isLoading: warehousesLoading } = useGetWarehouses();
  const hasActiveWarehouse = warehouses.some((warehouse) => warehouse.isActive);
  const canReceiveStock = hasActiveWarehouse;
  const canCreateMaterial = canMutateInventory && hasActiveWarehouse && !warehousesLoading;

  useEffect(() => {
    const itemId = searchParams.get("item")?.trim();
    if (!itemId) return;
    setDetailId(itemId);
    const next = new URLSearchParams(searchParams);
    next.delete("item");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const debouncedSearch = useDebounce(searchQuery, 400);
  // Drop removed sort keys (e.g. former selling_price) back to the list default.
  useEffect(() => {
    if (!sortOptions.some((option) => option.value === sortValue)) {
      setSortValue(DEFAULT_SORT_VALUE);
    }
  }, [sortValue]);

  const sortOption =
    sortOptions.find((option) => option.value === sortValue) ??
    sortOptions.find((option) => option.value === DEFAULT_SORT_VALUE) ??
    sortOptions[0];
  const sort: InventorySort = { field: sortOption.field, ascending: sortOption.ascending };

  const { data: workspace } = useGetWorkspace(workspaceId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ListPageSize>(DEFAULT_LIST_PAGE_SIZE);
  // After a page switch the list starts at the top of the screen (filters scroll out of view).
  const listTop = useListTopAnchor();
  // Paginated in the database: search, filters, supplier and sort run there; one page is loaded.
  const {
    data: inventoryPage,
    isLoading,
    isError,
    refetch,
  } = useInventoryPage({ search: debouncedSearch, filter: stockFilter, sort, supplier: supplierFilter, page, pageSize });
  const items = useMemo(() => inventoryPage?.rows ?? [], [inventoryPage]);
  // Thumbnails of this page only: one signed-URL request for all of them.
  const photoPaths = useMemo(() => items.map((item) => item.photoPath), [items]);
  const thumbUrl = useInventoryThumbUrls(photoPaths);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, stockFilter, supplierFilter, sortValue, pageSize]);
  const { suppliers, isLoading: suppliersLoading } = useGetInventorySuppliers();

  // A selected supplier can disappear (renamed/deleted): fall back to "all".
  useEffect(() => {
    if (suppliersLoading || supplierFilter === "all") return;
    if (!suppliers.includes(supplierFilter)) setSupplierFilter("all");
  }, [suppliers, suppliersLoading, supplierFilter]);
  const {
    data: attention,
    isLoading: attentionLoading,
    isError: attentionError,
    refetch: refetchAttention,
  } = useStockAttention(5);
  const detailQuery = useGetInventoryItem(detailId);
  const hasSearchOrFilter = Boolean(debouncedSearch) || stockFilter !== "active" || supplierFilter !== "all";

  const stockFilters = [
    { value: "active", label: t("common.all") },
    { value: "in_stock", label: t("status.inventory.in_stock") },
    { value: "low_stock", label: t("status.inventory.low_stock") },
    { value: "out_of_stock", label: t("status.inventory.out_of_stock") },
    { value: "inactive", label: t("inventory.inactive") },
    { value: "all", label: t("inventory.filters.allIncludingInactive") },
  ];

  // Stable handlers: memoized inventory cards don't re-render when a dialog opens.
  const formatCardMoney = useStableCallback((value: number | null) => formatWorkspaceMoney(value, workspace?.currency));
  const viewCardItem = useStableCallback((selected: InventoryItem) => setDetailId(selected.id));
  const editCardItem = useStableCallback((selected: InventoryItem) => setEditId(selected.id));

  const columns: Column<InventoryItem>[] = [
    {
      key: "name",
      header: fieldLabels.label("name", t("inventory.fields.name")),
      cell: (item) => (
        <div className="flex max-w-[13rem] min-w-0 items-center gap-2 xl:max-w-[14rem] 2xl:max-w-[18rem]">
          <p className="truncate font-medium text-foreground" title={item.name}>{item.name}</p>
          {!item.isActive && <StatusBadge variant="muted">{t("inventory.inactive")}</StatusBadge>}
        </div>
      ),
    },
    {
      key: "sku",
      header: fieldLabels.label("sku", t("inventory.fields.sku")),
      cell: (item) => <span className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</span>,
      className: "hidden sm:table-cell whitespace-nowrap",
    },
    {
      key: "supplier",
      header: fieldLabels.label("supplier", t("inventory.fields.supplier")),
      cell: (item) => (
        <SupplierLink
          supplier={item.supplier}
          className="block max-w-[10rem] truncate"
          emptyClassName="block max-w-[10rem] truncate text-muted-foreground"
        />
      ),
      className: "hidden md:table-cell",
    },
    {
      key: "category",
      header: fieldLabels.label("category", t("inventory.fields.category")),
      cell: (item) => <span className="block max-w-[10rem] truncate text-muted-foreground" title={item.category}>{item.category || "—"}</span>,
      className: "hidden xl:table-cell",
    },
    {
      key: "quantity",
      header: fieldLabels.label("quantity", t("inventory.fields.quantity")),
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
      cell: (item) => <InventoryStatusBadge status={effectiveStockStatus(item)} />,
    },
    {
      key: "unit",
      header: fieldLabels.label("unit", t("inventory.fields.unit")),
      cell: (item) => <span className="text-muted-foreground">{item.unit}</span>,
      className: "hidden 2xl:table-cell",
    },
    {
      key: "purchasePrice",
      header: fieldLabels.label("purchasePrice", t("inventory.fields.purchasePrice")),
      cell: (item) => (
        <span className="font-medium tabular-nums">{formatWorkspaceMoney(item.purchasePrice, workspace?.currency)}</span>
      ),
      className: "hidden sm:table-cell text-right whitespace-nowrap",
    },
    {
      key: "photo",
      header: t("inventory.photo.column"),
      className: "w-[64px] text-center",
      cell: (item) => <InventoryPhotoThumb photoPath={item.photoPath} thumbUrl={thumbUrl(item.photoPath)} name={item.name} />,
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
        title={inventoryCopy.title}
        description={
          isLoading ? inventoryCopy.loading : isError ? t("inventory.loadFailedSummary") : industryInventoryItemCount(workflow, inventoryPage?.total ?? 0)
        }
        actions={
          canMutateInventory ? (
            <Button onClick={openCreate} disabled={!canCreateMaterial}>
              <Plus />
              {inventoryCopy.addItem}
            </Button>
          ) : undefined
        }
      />

      {!warehousesLoading && canMutateInventory && !hasActiveWarehouse ? (
        <Card>
          <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">{t("inventory.warehouseRequired.title")}</CardTitle>
              <CardDescription>{t("inventory.warehouseRequired.description")}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                const locale = languageFromPath(location.pathname);
                navigate(`/${locale}/${workspaceId}/warehouses`);
              }}
            >
              {t("inventory.warehouseRequired.openWarehouses")}
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      <SubscriptionReadOnlyNotice />

      <StockAttentionPanel
        attention={attention}
        isLoading={attentionLoading}
        isError={attentionError}
        activeFilter={stockFilter}
        onFilter={(filter) => {
          setSearchQuery("");
          setStockFilter(filter);
        }}
        onOpenItem={(item) => setDetailId(item.id)}
        onRetry={() => refetchAttention()}
      />

      <CategoriesPanel />

      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Warehouse className="size-4" aria-hidden />
              {t("warehouses.inventoryLink.title")}
            </CardTitle>
            <CardDescription>{t("warehouses.inventoryLink.description")}</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              const locale = languageFromPath(location.pathname);
              navigate(`/${locale}/${workspaceId}/warehouses`);
            }}
          >
            {t("warehouses.inventoryLink.open")}
          </Button>
        </CardHeader>
      </Card>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchAndFilters
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={inventoryCopy.searchPlaceholder}
          filters={[
            {
              key: "stock",
              label: t("inventory.filters.stock"),
              options: stockFilters,
              value: stockFilter,
              onChange: (value) => setStockFilter(value as InventoryListFilter),
            },
            {
              key: "supplier",
              label: t("inventory.filters.supplier"),
              options: [
                { value: "all", label: t("inventory.filters.allSuppliers") },
                ...suppliers.map((supplier) => ({ value: supplier, label: supplier })),
              ],
              value: supplierFilter,
              onChange: setSupplierFilter,
            },
          ]}
          onClearFilters={() => {
            setSearchQuery("");
            setStockFilter("active");
            setSupplierFilter("all");
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

      <div ref={listTop.ref}>
      {isError ? (
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <ErrorState title={t("inventory.loadError.title")} description={t("inventory.loadError.listDescription")} onRetry={() => refetch()} />
        </div>
      ) : isMobile ? (
        isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
            {hasSearchOrFilter ? (
              <NoSearchResults
                query={
                  searchQuery ||
                  (supplierFilter !== "all" ? supplierFilter : stockFilters.find((option) => option.value === stockFilter)?.label || stockFilter)
                }
              />
            ) : (
              <NoInventory onAddItem={canCreateMaterial ? openCreate : undefined} />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <InventoryCard
                key={item.id}
                item={item}
                thumbUrl={thumbUrl(item.photoPath)}
                formatMoney={formatCardMoney}
                onView={viewCardItem}
                onEdit={editCardItem}
                onDelete={setItemToDelete}
              />
            ))}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          keyExtractor={(item) => item.id}
          onRowClick={(item) => setDetailId(item.id)}
          rowClassName={(item) => {
            const status = effectiveStockStatus(item);
            return status === "out_of_stock" ? "bg-destructive/[0.035]" : status === "low_stock" ? "bg-warning/[0.045]" : undefined;
          }}
          emptyState={
            hasSearchOrFilter ? (
              <NoSearchResults
                query={
                  searchQuery ||
                  (supplierFilter !== "all" ? supplierFilter : stockFilters.find((option) => option.value === stockFilter)?.label || stockFilter)
                }
              />
            ) : (
              <NoInventory onAddItem={canCreateMaterial ? openCreate : undefined} />
            )
          }
        />
      )}

      </div>

      {!isLoading && (inventoryPage?.total ?? 0) > 0 ? (
        <ServerListPager
          page={inventoryPage?.page ?? page}
          pageCount={inventoryPage?.pageCount ?? 1}
          pageSize={pageSize}
          total={inventoryPage?.total ?? 0}
          onPageChange={(next) => {
            setPage(next);
            listTop.scrollToListTop();
          }}
          onPageSizeChange={(size) => {
            setPageSize(size);
            listTop.scrollToListTop();
          }}
        />
      ) : null}

      <DialogLauncher ref={createLauncher}>
        {({ open, setOpen }) => (
          <AddInventoryItemDialog
            open={open && canCreateMaterial}
            onOpenChange={(next) => {
              if (!next || canCreateMaterial) setOpen(next);
            }}
            onCreated={(item) => {
              if (canReceiveStock) setReceiveItem(item);
            }}
          />
        )}
      </DialogLauncher>

      <QuickGoodsReceiptDialog
        open={Boolean(receiveItem)}
        onOpenChange={(next) => {
          if (!next) setReceiveItem(null);
        }}
        item={receiveItem}
        defaultQuantity={1}
      />

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
