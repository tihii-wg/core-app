import { clampPage, pageCountFor } from "./paginate";

/** Page sizes of the server-paginated lists (clients, services, parts). */
export const LIST_PAGE_SIZES = [25, 50, 100] as const;
export type ListPageSize = (typeof LIST_PAGE_SIZES)[number];
export const DEFAULT_LIST_PAGE_SIZE: ListPageSize = 50;

export function toListPageSize(value: unknown): ListPageSize {
  const size = Number(value);
  return (LIST_PAGE_SIZES as readonly number[]).includes(size) ? (size as ListPageSize) : DEFAULT_LIST_PAGE_SIZE;
}

/** One page of a list read with `.range()` + `count: "exact"` — only these rows travel over the network. */
export type ServerPage<T> = {
  rows: T[];
  /** Rows matching the filters in the whole table (not only this page). */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Inclusive `.range(from, to)` bounds of a 1-based page. */
export function pageBounds(page: number, pageSize: number): { from: number; to: number } {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function serverPage<T>(rows: T[], total: number, page: number, pageSize: number): ServerPage<T> {
  const pageCount = pageCountFor(total, pageSize);
  return { rows, total, page: clampPage(page, pageCount), pageSize, pageCount };
}

export function emptyServerPage<T>(pageSize: number): ServerPage<T> {
  return { rows: [], total: 0, page: 1, pageSize, pageCount: 1 };
}

/** PostgREST answers 416 / PGRST103 when the requested range starts past the last row (page beyond the end). */
export function isRangeBeyondEnd(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST103" || /range not satisfiable|requested range/i.test(error.message ?? "");
}
