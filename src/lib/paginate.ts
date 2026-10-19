/** 1-based page window over a list (client-side pagination). */
export type PageWindow<T> = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  items: T[];
};

export function clampPage(page: number, pageCount: number): number {
  if (pageCount < 1) return 1;
  return Math.min(Math.max(1, page), pageCount);
}

export function pageCountFor(total: number, pageSize: number): number {
  if (pageSize < 1) return 1;
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** Build the current page slice. `page` is 1-based and clamped to the available range. */
export function paginateItems<T>(items: T[], page: number, pageSize: number): PageWindow<T> {
  const total = items.length;
  const size = Math.max(1, pageSize);
  const pageCount = pageCountFor(total, size);
  const current = clampPage(page, pageCount);
  const start = total === 0 ? 0 : (current - 1) * size;
  const end = Math.min(start + size, total);
  return {
    page: current,
    pageSize: size,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: end,
    items: items.slice(start, end),
  };
}

/** Compact page list for controls: `1 … 4 5 6 … 20`. */
export function paginationItems(current: number, pageCount: number, siblingCount = 1): Array<number | "ellipsis"> {
  const total = Math.max(1, pageCount);
  const page = clampPage(current, total);
  if (total <= siblingCount * 2 + 5) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const left = Math.max(2, page - siblingCount);
  const right = Math.min(total - 1, page + siblingCount);
  const items: Array<number | "ellipsis"> = [1];

  if (left > 2) items.push("ellipsis");
  for (let value = left; value <= right; value += 1) items.push(value);
  if (right < total - 1) items.push("ellipsis");
  items.push(total);

  return items;
}
