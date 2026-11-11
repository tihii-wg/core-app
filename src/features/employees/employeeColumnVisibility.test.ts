import { beforeEach, describe, expect, it } from "vitest";
import { stubLocalStorage } from "../../tests/memoryStorage";
import {
  DEFAULT_EMPLOYEE_VISIBLE_COLUMNS,
  EMPLOYEE_COLUMN_STORAGE_KEY,
  readEmployeeVisibleColumns,
  writeEmployeeVisibleColumns,
} from "./employeeColumnVisibility";

describe("employeeColumnVisibility", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("returns every toggleable column by default", () => {
    expect(readEmployeeVisibleColumns()).toEqual(DEFAULT_EMPLOYEE_VISIBLE_COLUMNS);
  });

  it("persists and restores a custom column selection including closed", () => {
    writeEmployeeVisibleColumns(["open", "closed"]);
    expect(JSON.parse(window.localStorage.getItem(EMPLOYEE_COLUMN_STORAGE_KEY) ?? "[]")).toEqual(["open", "closed"]);
    expect(readEmployeeVisibleColumns()).toEqual(["open", "closed"]);
  });

  it("ignores unknown keys and falls back when nothing valid remains", () => {
    window.localStorage.setItem(EMPLOYEE_COLUMN_STORAGE_KEY, JSON.stringify(["role", "not-a-column"]));
    expect(readEmployeeVisibleColumns()).toEqual(["role"]);

    window.localStorage.setItem(EMPLOYEE_COLUMN_STORAGE_KEY, JSON.stringify(["nope"]));
    expect(readEmployeeVisibleColumns()).toEqual(DEFAULT_EMPLOYEE_VISIBLE_COLUMNS);

    window.localStorage.setItem(EMPLOYEE_COLUMN_STORAGE_KEY, "{not-json");
    expect(readEmployeeVisibleColumns()).toEqual(DEFAULT_EMPLOYEE_VISIBLE_COLUMNS);
  });
});
