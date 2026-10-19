import { describe, expect, it } from "vitest";
import { clampPage, pageCountFor, paginateItems, paginationItems } from "./paginate";

describe("paginateItems", () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);

  it("returns the first page by default", () => {
    expect(paginateItems(items, 1, 10)).toEqual({
      page: 1,
      pageSize: 10,
      pageCount: 3,
      total: 25,
      from: 1,
      to: 10,
      items: items.slice(0, 10),
    });
  });

  it("returns a middle page and clamps past the end", () => {
    expect(paginateItems(items, 2, 10).items).toEqual(items.slice(10, 20));
    expect(paginateItems(items, 99, 10)).toMatchObject({ page: 3, from: 21, to: 25, items: items.slice(20) });
  });

  it("handles an empty list", () => {
    expect(paginateItems([], 3, 10)).toEqual({
      page: 1,
      pageSize: 10,
      pageCount: 1,
      total: 0,
      from: 0,
      to: 0,
      items: [],
    });
  });
});

describe("paginationItems", () => {
  it("lists every page when the range is short", () => {
    expect(paginationItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("inserts ellipses for long ranges", () => {
    expect(paginationItems(1, 20)).toEqual([1, 2, "ellipsis", 20]);
    expect(paginationItems(10, 20)).toEqual([1, "ellipsis", 9, 10, 11, "ellipsis", 20]);
    expect(paginationItems(20, 20)).toEqual([1, "ellipsis", 19, 20]);
  });
});

describe("page helpers", () => {
  it("computes page counts and clamps the current page", () => {
    expect(pageCountFor(25, 10)).toBe(3);
    expect(pageCountFor(0, 10)).toBe(1);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(9, 3)).toBe(3);
  });
});
