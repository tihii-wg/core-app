import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "./Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Button } from "./Button";
import { cn } from "../lib/utils";

interface FilterOption {
  value: string;
  label: string;
}

interface Filter {
  key: string;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}

interface SearchAndFiltersProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: Filter[];
  onClearFilters?: () => void;
  className?: string;
}
export function SearchAndFilters({ searchValue, onSearchChange, searchPlaceholder: placeholder, filters = [], onClearFilters, className }: SearchAndFiltersProps) {
  const { t } = useTranslation();
  const searchPlaceholder = placeholder ?? t("common.searchPlaceholder");
  const hasActiveFilters = filters.some((f) => f.value && f.value !== "all");

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      <div className="relative w-full sm:max-w-xs sm:flex-1 lg:max-w-sm">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
        <Input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder.replace(/\.+$/, "")}
          className="h-9 pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label={t("common.clearSearch")}
            className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-subtle-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {filters.map((filter) => (
        <Select key={filter.key} value={filter.value} onValueChange={filter.onChange}>
          <SelectTrigger aria-label={filter.label} className={cn("h-9 w-full text-[13px] sm:w-44", filter.value && filter.value !== "all" && "border-primary/40 bg-accent/60")}>
            <SelectValue placeholder={filter.label} />
          </SelectTrigger>
          <SelectContent>
            {filter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasActiveFilters && onClearFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-9 self-start sm:self-auto">
          <X />
          {t("common.clearFilters")}
        </Button>
      )}
    </div>
  );
}
