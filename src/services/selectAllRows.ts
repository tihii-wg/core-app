/**
 * The API returns at most 1 000 rows per request (PostgREST max-rows), silently: a workspace with more clients,
 * parts or payments than that simply lost the rest of its list. `selectAllRows` reads a list in pages — the first
 * page alone, then (only when it was full) the next pages 4 at a time — and concatenates them.
 *
 * `page(from, to)` must build a FRESH query for every call (a query builder is mutable: `.range()` rewrites its
 * own URL) and order it by a unique tiebreaker (e.g. `id`) so the pages neither overlap nor skip rows.
 */
export const API_ROW_LIMIT = 1000;

const PARALLEL_PAGES = 4;

type PageError = { code?: string; message: string; details?: string; hint?: string };
type PageResult = { data: unknown; error: PageError | null };

export async function selectAllRows<T = Record<string, unknown>, E extends PageError = PageError>(
  page: (from: number, to: number) => PromiseLike<PageResult>,
  pageSize = API_ROW_LIMIT,
): Promise<{ data: T[] | null; error: E | null }> {
  const first = await Promise.resolve(page(0, pageSize - 1));
  if (first.error) return { data: null, error: first.error as E };
  const rows = [...((first.data ?? []) as T[])];
  if (rows.length < pageSize) return { data: rows, error: null };

  for (let from = pageSize; ; from += pageSize * PARALLEL_PAGES) {
    const pages = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, (_, index) =>
        Promise.resolve(page(from + index * pageSize, from + (index + 1) * pageSize - 1)),
      ),
    );
    const failed = pages.find((result) => result.error);
    if (failed) return { data: null, error: failed.error as E };
    for (const result of pages) rows.push(...((result.data ?? []) as T[]));
    if (pages.some((result) => ((result.data as unknown[] | null)?.length ?? 0) < pageSize)) break;
  }
  return { data: rows, error: null };
}
