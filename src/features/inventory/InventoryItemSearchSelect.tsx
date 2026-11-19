import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown } from "lucide-react";
import type { InventoryItem } from "../../lib/types";
import { useDebounce } from "../../hooks/useDebounce";
import { cn } from "../../lib/utils";
import { Input } from "../../ui/Input";
import { useInventorySearch } from "./useGetInventoryItems";

const SEARCH_LIMIT = 50;

type InventoryItemSearchSelectProps = {
  /** Currently chosen part (shown when the field is not being typed into). */
  selected: InventoryItem | undefined;
  onPick: (item: InventoryItem) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
};

/**
 * Single part picker backed by a database search (name / SKU / category / supplier, every word): replaces a
 * <Select> that had to render the whole catalog. Shows at most 50 matches — typing narrows them down.
 */
export function InventoryItemSearchSelect({ selected, onPick, disabled, placeholder, ariaLabel }: InventoryItemSearchSelectProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 200);
  const rootRef = useRef<HTMLDivElement>(null);
  const { items, total, isLoading } = useInventorySearch({ query: debouncedQuery, limit: SEARCH_LIMIT }, { enabled: open });

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const selectedLabel = selected ? `${selected.name}${selected.sku ? ` · ${selected.sku}` : ""}` : "";

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          autoComplete="off"
          disabled={disabled}
          placeholder={selectedLabel || placeholder}
          value={open ? query : selectedLabel}
          className={cn("pr-8", !open && selected ? "text-foreground" : undefined)}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      </div>
      {open ? (
        <div id={listId} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow">
          {items.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {isLoading || debouncedQuery !== query ? t("common.loading") : t("orders.form.materialEmpty")}
            </p>
          ) : (
            <>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === selected?.id}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted",
                    item.id === selected?.id ? "bg-muted/60" : undefined,
                  )}
                  onClick={() => {
                    onPick(item);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate">
                    {item.name}
                    {item.sku ? <span className="text-muted-foreground"> · {item.sku}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {item.quantity} {item.unit}
                  </span>
                </button>
              ))}
              {total > items.length ? (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {t("common.pagination.showing", { from: 1, to: items.length, total })}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
