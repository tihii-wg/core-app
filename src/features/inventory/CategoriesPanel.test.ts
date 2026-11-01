import { describe, expect, it } from "vitest";
import type { CategoryRecord } from "../../services/apiCategories";
import { flattenCategories } from "./CategoriesPanel";

function category(id: string, name: string, parentId: string | null = null): CategoryRecord {
  return { id, workspaceId: "ws", scope: "product", parentId, name, sortOrder: 0 };
}

describe("flattenCategories", () => {
  it("orders children after their parent with depth", () => {
    const rows = flattenCategories([category("b", "Brakes", "a"), category("a", "Parts"), category("c", "Oil")]);
    expect(rows.map((row) => [row.category.id, row.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
  });

  it("treats orphans as roots and survives cycles", () => {
    const rows = flattenCategories([category("x", "Orphan", "missing"), category("p", "P", "q"), category("q", "Q", "p")]);
    expect(rows.map((row) => row.category.id)).toEqual(["x"]);
  });
});
