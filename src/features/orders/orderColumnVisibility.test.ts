import { beforeEach, describe, expect, it } from "vitest";
import { stubLocalStorage } from "../../tests/memoryStorage";
import {
  DEFAULT_ORDER_VISIBLE_COLUMNS,
  ORDER_COLUMN_STORAGE_KEY,
  readOrderVisibleColumns,
  writeOrderVisibleColumns,
} from "./orderColumnVisibility";

describe("orderColumnVisibility", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("returns every toggleable column by default", () => {
    expect(readOrderVisibleColumns()).toEqual(DEFAULT_ORDER_VISIBLE_COLUMNS);
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
});
