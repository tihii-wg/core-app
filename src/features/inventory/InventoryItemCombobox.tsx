import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Input } from "../../ui/Input";
import type { InventoryItem } from "../../lib/types";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useDebounce } from "../../hooks/useDebounce";
import { useInventorySearch } from "./useGetInventoryItems";

/** Rows shown by the database-backed search (type more to narrow it down). */
const SEARCH_LIMIT = 50;

type InventoryItemComboboxProps = {
  /** Fixed list to pick from. Omitted → the catalog is searched in the database as the user types. */
  items?: InventoryItem[];
  errors?: boolean;
  onSelect?: (item: InventoryItem) => void;
  /** Opens inventory creation when the filtered list is empty. */
  onCreateRequest?: (searchQuery: string) => void;
  /** Prefills the one-time / order-only material form when the filtered list is empty. */
  onAddOneTimeRequest?: (searchQuery: string) => void;
  /** Industry-aware search placeholder; falls back to orders.form.materialSearchPlaceholder. */
  searchPlaceholder?: string;
  /**
   * Optional per-item on-hand for the currently selected warehouse.
   * When set, the list shows warehouse stock (incl. "out of stock") instead of the global total.
   */
  warehouseStockByItemId?: ReadonlyMap<string, number> | Record<string, number>;
  /** Called when the user picks an out-of-stock row (row stays visible). */
  onSelectOutOfStock?: (item: InventoryItem) => void;
};

function stockForItem(
  item: InventoryItem,
  warehouseStockByItemId: InventoryItemComboboxProps["warehouseStockByItemId"],
): number {
  if (!warehouseStockByItemId) return Number(item.quantity) || 0;
  if (warehouseStockByItemId instanceof Map) return Number(warehouseStockByItemId.get(item.id) ?? 0) || 0;
  return Number((warehouseStockByItemId as Record<string, number>)[item.id] ?? 0) || 0;
}

export default function InventoryItemCombobox({
  items,
  errors,
  onSelect,
  onCreateRequest,
  onAddOneTimeRequest,
  searchPlaceholder,
  warehouseStockByItemId,
  onSelectOutOfStock,
}: InventoryItemComboboxProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const debouncedQuery = useDebounce(query, 200);
  const search = useInventorySearch({ query: debouncedQuery, limit: SEARCH_LIMIT }, { enabled: open && !items });
  const source = items ?? search.items;
  const normalized = query.trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const filtered = source.filter((item) => {
    if (!item.isActive) return false;
    if (!normalized) return true;
    if (!items) {
      // Server results: every word in name / SKU / category / supplier (same rule as the query).
      const haystack = `${item.name} ${item.sku} ${item.category ?? ""} ${item.supplier ?? ""}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    }
    return item.name.toLowerCase().includes(normalized) || item.sku.toLowerCase().includes(normalized);
  });
  const searching = !items && (search.isLoading || debouncedQuery !== query);

  const showCreate = Boolean(onCreateRequest) && filtered.length === 0;
  const showOneTime = Boolean(onAddOneTimeRequest) && filtered.length === 0 && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Input
        id="order-material"
        name="order-material"
        value={query}
        autoComplete="off"
        placeholder={searchPlaceholder || t("orders.form.materialSearchPlaceholder")}
        className={`w-full rounded-md border px-3 py-2 ${errors ? "border-destructive" : ""}`}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />

      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow">
          {filtered.length === 0 && searching ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <div className="space-y-2 px-3 py-3">
              <p className="text-sm text-muted-foreground">{t("orders.form.materialEmpty")}</p>
              {showOneTime ? (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  onClick={() => {
                    onAddOneTimeRequest?.(query.trim());
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("orders.form.addAsOneTimePart")}
                </button>
              ) : null}
              {showCreate ? (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  onClick={() => {
                    onCreateRequest?.(query.trim());
                    setOpen(false);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("orders.form.createNewMaterial")}
                </button>
              ) : null}
            </div>
          ) : (
            filtered.map((item) => {
              const priceLabel = formatMoney(item.sellingPrice ?? 0);
              const stockCount = stockForItem(item, warehouseStockByItemId);
              const outOfStock = warehouseStockByItemId != null && stockCount <= 0;
              const stockLabel = outOfStock
                ? t("orders.form.outOfStockOnWarehouse")
                : t("orders.form.availableStockValue", { count: stockCount, unit: item.unit });
              return (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                  aria-label={t("orders.form.materialOptionAria", { name: item.name, stock: stockLabel, price: priceLabel })}
                  onClick={() => {
                    if (outOfStock) {
                      onSelectOutOfStock?.(item);
                      setQuery("");
                      setOpen(false);
                      return;
                    }
                    onSelect?.(item);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
                    <span
                      className={`mt-0.5 block truncate text-xs ${outOfStock ? "text-destructive/80" : "text-muted-foreground"}`}
                    >
                      {stockLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{priceLabel}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
