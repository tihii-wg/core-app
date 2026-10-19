import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paginationItems } from "../lib/paginate";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "./pagination";

type ListPaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Optional “Showing X–Y of Z” (or similar) rendered on the left. */
  summary?: ReactNode;
  className?: string;
};

export function ListPagination({ page, pageCount, onPageChange, summary, className }: ListPaginationProps) {
  const { t } = useTranslation();
  if (pageCount <= 1 && !summary) return null;

  const pages = paginationItems(page, pageCount);

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : <span />}
      {pageCount > 1 ? (
        <Pagination className="mx-0 w-auto justify-start sm:justify-end">
          <PaginationContent>
            <PaginationItem>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 px-2.5"
                disabled={page <= 1}
                aria-label={t("common.pagination.previous")}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeft />
                <span className="hidden sm:inline">{t("common.pagination.previous")}</span>
              </Button>
            </PaginationItem>
            {pages.map((item, index) =>
              item === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <Button
                    type="button"
                    variant={item === page ? "outline" : "ghost"}
                    size="icon-sm"
                    aria-label={t("common.pagination.page", { page: item })}
                    aria-current={item === page ? "page" : undefined}
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </Button>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 px-2.5"
                disabled={page >= pageCount}
                aria-label={t("common.pagination.next")}
                onClick={() => onPageChange(page + 1)}
              >
                <span className="hidden sm:inline">{t("common.pagination.next")}</span>
                <ChevronRight />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}
