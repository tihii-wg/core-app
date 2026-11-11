import { describe, expect, it } from "vitest";
import type { InventoryItem, Service } from "../../lib/types";
import {
  filterInventoryForAddLinesSearch,
  filterServicesForAddLinesSearch,
  matchesAddLinesTokens,
  takeAddLinesSearchGroup,
  tokenizeAddLinesQuery,
} from "./orderAddLinesSearchFilter";

describe("orderAddLinesSearchFilter helpers", () => {
  it("tokenizes with case folding and collapses extra spaces", () => {
    expect(tokenizeAddLinesQuery("  Oil   FILTER  ")).toEqual(["oil", "filter"]);
    expect(tokenizeAddLinesQuery("")).toEqual([]);
  });

  it("matches with token AND semantics", () => {
    expect(matchesAddLinesTokens("Oil Change Filter", ["oil", "filter"])).toBe(true);
    expect(matchesAddLinesTokens("Oil Change", ["oil", "filter"])).toBe(false);
    expect(matchesAddLinesTokens("anything", [])).toBe(true);
  });

  it("filters active services by name and category", () => {
    const services = [
      { id: "1", service_name: "Oil change", category: "Maintenance", status: "active" },
      { id: "2", service_name: "Alignment", category: "Chassis", status: "active" },
      { id: "3", service_name: "Oil leak", category: "Maintenance", status: "inactive" },
    ] as Service[];

    expect(filterServicesForAddLinesSearch(services, "oil main").map((s) => s.id)).toEqual(["1"]);
    expect(filterServicesForAddLinesSearch(services, "").map((s) => s.id)).toEqual(["1", "2"]);
  });

  it("filters active inventory by name, sku, category, and supplier", () => {
    const items = [
      {
        id: "a",
        name: "Oil filter",
        sku: "OF-1",
        category: "Filters",
        supplier: "Bosch",
        isActive: true,
      },
      {
        id: "b",
        name: "Brake pad",
        sku: "BP-9",
        category: "Brakes",
        supplier: "Brembo",
        isActive: true,
      },
      {
        id: "c",
        name: "Oil filter unused",
        sku: "OF-2",
        category: "Filters",
        supplier: "Bosch",
        isActive: false,
      },
    ] as InventoryItem[];

    expect(filterInventoryForAddLinesSearch(items, "bosch oil").map((i) => i.id)).toEqual(["a"]);
    expect(filterInventoryForAddLinesSearch(items, "bp-9").map((i) => i.id)).toEqual(["b"]);
  });

  it("limits groups and reports hidden count", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(takeAddLinesSearchGroup(items, false, 8)).toEqual({
      visible: [0, 1, 2, 3, 4, 5, 6, 7],
      hiddenCount: 2,
    });
    expect(takeAddLinesSearchGroup(items, true, 8).hiddenCount).toBe(0);
  });
});
