import { Search, X } from "lucide-react";
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
export function SearchAndFilters({ searchValue, onSearchChange, searchPlaceholder = "Search...", filters = [], onClearFilters, className }: SearchAndFiltersProps) {
  // const filterValue = filters.map((f) => f.value);
  // console.log(filterValue);

  const hasActiveFilters = filters.some((f) => f.value && f.value !== "all");

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}>
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#939699]" />
        <Input value={searchValue} onChange={(e) => onSearchChange(e.target.value)} placeholder={searchPlaceholder} className="pl-9 h-9 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-[#1973e1]" />
        {searchValue && (
          <button onClick={() => onSearchChange("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {filters.map((filter) => (
        <Select key={filter.key} value={filter.value} onValueChange={filter.onChange}>
          <SelectTrigger className="h-9 w-full sm:w-40 border-[#c9cbcc] text-sm">
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
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-[#939699] hover:text-[#282e33] h-9 px-3">
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
