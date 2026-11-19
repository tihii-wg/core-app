import { useTranslation } from "react-i18next";
import { LIST_PAGE_SIZES, type ListPageSize } from "../lib/serverPaging";
import { ListPagination } from "./ListPagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

type ServerListPagerProps = {
  page: number;
  pageCount: number;
  pageSize: ListPageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: ListPageSize) => void;
};

/** "Showing X–Y of Z · Page N of M" + page buttons + page-size select for a server-paginated list. */
export function ServerListPager({ page, pageCount, pageSize, total, onPageChange, onPageSizeChange }: ServerListPagerProps) {
  const { t } = useTranslation();
  if (total <= 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const summary = `${t("common.pagination.showing", { from, to, total })} · ${t("common.pagination.pageOf", { page, pageCount })}`;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <ListPagination
        className="min-w-0 flex-1 sm:justify-between"
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        summary={summary}
      />
      <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value) as ListPageSize)}>
        <SelectTrigger className="h-9 w-full text-[13px] sm:w-40" aria-label={t("common.pagination.pageSize")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LIST_PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {t("common.pagination.perPage", { count: size })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
