import { EllipsisVertical, Eye, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InventoryItem } from "../../lib/types";
import { Button } from "../../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/DropdownMenu";
import { InventoryStatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import { quantityClass } from "./inventoryDisplay";
import { effectiveStockStatus } from "./stockStatus";

type InventoryCardProps = {
  item: InventoryItem;
  formatMoney: (value: number | null) => string;
  onView: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
};

/**
 * Compact phone layout for one inventory item (below the md breakpoint).
 * The whole surface opens the item detail; the actions menu is independent.
 */
export function InventoryCard({ item, formatMoney, onView, onEdit, onDelete }: InventoryCardProps) {
  const { t } = useTranslation();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <article
      onClick={() => onView(item)}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 active:bg-accent/60"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground" title={item.name}>
            {item.name}
            {!item.isActive && <span className="ml-2 text-xs font-medium text-muted-foreground">{t("inventory.inactive")}</span>}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={item.sku || undefined}>
            {item.sku || "—"}
          </p>
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-10 shrink-0"
              aria-label={t("inventory.actions.menuLabel", { name: item.name })}
              onClick={stop}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" onClick={stop}>
            <DropdownMenuItem onSelect={() => onView(item)}>
              <Eye />
              {t("inventory.actions.viewDetails")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdit(item)}>
              <Pencil />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete(item)}
            >
              <Trash2 />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {item.supplier ? (
        <p className="mt-1 truncate text-[13px] text-muted-foreground" title={item.supplier}>
          {t("inventory.fields.supplier")}: {item.supplier}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2.5">
        <InventoryStatusBadge status={effectiveStockStatus(item)} />
        <span className={cn("tabular-nums text-sm", quantityClass(item))}>
          {item.quantity} {item.unit}
        </span>
        <span className="ml-auto font-semibold tabular-nums text-foreground">{formatMoney(item.sellingPrice)}</span>
      </div>
    </article>
  );
}
