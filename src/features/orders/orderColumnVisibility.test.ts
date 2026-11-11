import { beforeEach, describe, expect, it } from "vitest";
import { stubLocalStorage } from "../../tests/memoryStorage";
import {
  DEFAULT_DASHBOARD_ORDER_VISIBLE_COLUMNS,
  DEFAULT_ORDER_VISIBLE_COLUMNS,
  ORDER_COLUMN_STORAGE_KEY,
  ORDER_TOGGLEABLE_COLUMNS,
  readOrderVisibleColumns,
  writeOrderVisibleColumns,
} from "./orderColumnVisibility";

describe("orderColumnVisibility", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("returns every default column and never includes a standalone payment column", () => {
    expect(readOrderVisibleColumns()).toEqual(DEFAULT_ORDER_VISIBLE_COLUMNS);
    expect(ORDER_TOGGLEABLE_COLUMNS).not.toContain("payment");
    expect(DEFAULT_ORDER_VISIBLE_COLUMNS).not.toContain("payment");
    expect(DEFAULT_DASHBOARD_ORDER_VISIBLE_COLUMNS).not.toContain("payment");
    expect(DEFAULT_DASHBOARD_ORDER_VISIBLE_COLUMNS).toEqual(DEFAULT_ORDER_VISIBLE_COLUMNS);
  });

  it("persists and restores a custom column selection", () => {
    writeOrderVisibleColumns(["client", "status", "total"]);
    expect(JSON.parse(window.localStorage.getItem(ORDER_COLUMN_STORAGE_KEY) ?? "[]")).toEqual(["client", "status", "total"]);
    expect(readOrderVisibleColumns()).toEqual(["client", "status", "total"]);
  });

  it("ignores unknown keys and falls back when nothing valid remains", () => {
    window.localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify(["client", "not-a-column"]));
    expect(readOrderVisibleColumns()).toEqual(["client"]);

    window.localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify(["nope"]));
    expect(readOrderVisibleColumns()).toEqual(DEFAULT_ORDER_VISIBLE_COLUMNS);
  });

  it("drops a legacy stored payment column and keeps Status / Payment (status) visible", () => {
    window.localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify(["payment", "total"]));
    expect(readOrderVisibleColumns()).toEqual(["status", "total"]);

    window.localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify(["client", "payment", "status", "total"]));
    expect(readOrderVisibleColumns()).toEqual(["client", "status", "total"]);
  });

  it("does not write payment into saved preferences", () => {
    writeOrderVisibleColumns(["client", "payment" as never, "status", "total"]);
    expect(JSON.parse(window.localStorage.getItem(ORDER_COLUMN_STORAGE_KEY) ?? "[]")).toEqual([
      "client",
      "status",
      "total",
    ]);
  });
});
