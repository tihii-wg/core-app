import { AlertTriangle, Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InventoryItem, InventoryListFilter } from "../../lib/types";
import { InventoryStatusBadge } from "../../ui/StatusBadge";
import { effectiveStockStatus } from "./stockStatus";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../lib/utils";
import { quantityClass } from "./inventoryDisplay";
import { stockAttentionSummary } from "./stockAttention";

const PREVIEW_LIMIT = 5;

type StockAttentionPanelProps = {
  items: InventoryItem[];
  isLoading?: boolean;
  isError?: boolean;
  activeFilter: InventoryListFilter;
  onFilter: (filter: InventoryListFilter) => void;
  onOpenItem: (item: InventoryItem) => void;
  onRetry?: () => void;
};

export function StockAttentionPanel({
  items,
  isLoading = false,
  isError = false,
  activeFilter,
  onFilter,
  onOpenItem,
  onRetry,
}: StockAttentionPanelProps) {
  const { t } = useTranslation();
  const summary = stockAttentionSummary(items);

  if (isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-xs" aria-busy="true">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-2 h-3 w-72" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-36" />
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
        <p className="text-sm font-medium text-foreground">{t("inventory.attention.loadError")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("inventory.attention.loadErrorHint")}</p>
        {onRetry ? (
          <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={onRetry}>
            {t("common.retry")}
          </button>
        ) : null}
      </section>
    );
  }

  if (items.length === 0) return null;

  if (summary.attentionCount === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-card/60 px-4 py-3">
        <p className="text-sm font-medium text-foreground">{t("inventory.attention.allClearTitle")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("inventory.attention.allClearHint")}</p>
      </section>
    );
  }

  const preview = summary.items.slice(0, PREVIEW_LIMIT);
  const moreCount = summary.attentionCount - preview.length;

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t("inventory.attention.title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("inventory.attention.hint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.outCount > 0 ? (
            <button
              type="button"
              onClick={() => onFilter("out_of_stock")}
              aria-pressed={activeFilter === "out_of_stock"}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
                activeFilter === "out_of_stock"
                  ? "border-destructive/40 bg-destructive/15 text-destructive"
                  : "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15",
              )}
            >
              <Package aria-hidden="true" className="size-4" />
              {t("inventory.outOfStockCount", { count: summary.outCount })}
            </button>
          ) : null}
          {summary.lowCount > 0 ? (
            <button
              type="button"
              onClick={() => onFilter("low_stock")}
              aria-pressed={activeFilter === "low_stock"}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
                activeFilter === "low_stock"
                  ? "border-warning/40 bg-warning/15 text-warning"
                  : "border-warning/25 bg-warning/10 text-warning hover:bg-warning/15",
              )}
            >
              <AlertTriangle aria-hidden="true" className="size-4" />
              {t("inventory.lowStockCount", { count: summary.lowCount })}
            </button>
          ) : null}
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border rounded-md border border-border">
        {preview.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpenItem(item)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground" title={item.name}>
                  {item.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {item.sku ? `${item.sku} · ` : null}
                  <span className={cn("tabular-nums", quantityClass(item))}>
                    {item.quantity} {item.unit}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    / {t("inventory.attention.minLabel", { min: item.minQuantity, unit: item.unit })}
                  </span>
                </span>
              </span>
              <InventoryStatusBadge status={effectiveStockStatus(item)} />
            </button>
          </li>
        ))}
      </ul>

      {moreCount > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("inventory.attention.moreCount", { count: moreCount })}</p>
      ) : null}
    </section>
  );
}
