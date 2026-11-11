import { beforeEach, describe, expect, it } from "vitest";
import { stubLocalStorage } from "../../tests/memoryStorage";
import {
  CLIENT_COLUMN_STORAGE_KEY,
  DEFAULT_CLIENT_VISIBLE_COLUMNS,
  readClientVisibleColumns,
  writeClientVisibleColumns,
} from "./clientColumnVisibility";

describe("clientColumnVisibility", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("returns every toggleable column by default", () => {
    expect(readClientVisibleColumns()).toEqual(DEFAULT_CLIENT_VISIBLE_COLUMNS);
  });

  it("persists and restores a custom column selection", () => {
    writeClientVisibleColumns(["contact", "balance"]);
    expect(JSON.parse(window.localStorage.getItem(CLIENT_COLUMN_STORAGE_KEY) ?? "[]")).toEqual(["contact", "balance"]);
    expect(readClientVisibleColumns()).toEqual(["contact", "balance"]);
  });

  it("ignores unknown keys and falls back when nothing valid remains", () => {
    window.localStorage.setItem(CLIENT_COLUMN_STORAGE_KEY, JSON.stringify(["orders", "not-a-column"]));
    expect(readClientVisibleColumns()).toEqual(["orders"]);

    window.localStorage.setItem(CLIENT_COLUMN_STORAGE_KEY, JSON.stringify(["nope"]));
    expect(readClientVisibleColumns()).toEqual(DEFAULT_CLIENT_VISIBLE_COLUMNS);
  });
});
