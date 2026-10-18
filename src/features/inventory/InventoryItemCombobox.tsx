import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Input } from "../../ui/Input";
import type { InventoryItem } from "../../lib/types";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";

type InventoryItemComboboxProps = {
  items: InventoryItem[];
  errors?: boolean;
  onSelect?: (item: InventoryItem) => void;
  /** Opens inventory creation when the filtered list is empty. */
  onCreateRequest?: (searchQuery: string) => void;
};

export default function InventoryItemCombobox({ items, errors, onSelect, onCreateRequest }: InventoryItemComboboxProps) {
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

  const normalized = query.trim().toLowerCase();
  const filtered = (items ?? []).filter((item) => {
    if (!item.isActive) return false;
    if (!normalized) return true;
    return item.name.toLowerCase().includes(normalized) || item.sku.toLowerCase().includes(normalized);
  });

  const showCreate = Boolean(onCreateRequest) && filtered.length === 0;

  return (
    <div ref={containerRef} className="relative">
      <Input
        id="order-material"
        name="order-material"
        value={query}
        autoComplete="off"
        placeholder={t("orders.form.materialSearchPlaceholder")}
        className={`w-full rounded-md border px-3 py-2 ${errors ? "border-destructive" : ""}`}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />

      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow">
          {filtered.length === 0 ? (
            <div className="space-y-2 px-3 py-3">
              <p className="text-sm text-muted-foreground">{t("orders.form.materialEmpty")}</p>
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
              const stockLabel = t("orders.form.availableStockValue", { count: item.quantity, unit: item.unit });
              return (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                  aria-label={t("orders.form.materialOptionAria", { name: item.name, stock: stockLabel, price: priceLabel })}
                  onClick={() => {
                    onSelect?.(item);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{stockLabel}</span>
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
