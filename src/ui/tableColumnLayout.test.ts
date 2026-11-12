import { describe, expect, it } from "vitest";
import {
  applyVisibleColumnReorder,
  mergeColumnOrder,
  mergeColumnWidths,
  resolveTableColumnLayout,
} from "./tableColumnLayout";

describe("mergeColumnOrder", () => {
  it("drops unknown stored columns and appends new ones at default-relative positions", () => {
    const defaults = ["orderNumber", "client", "device", "status", "total", "actions"];
    const stored = ["client", "gone", "orderNumber", "total"];
    // New columns (device, status) are inserted after their nearest preceding default neighbour.
    expect(mergeColumnOrder(defaults, stored, ["actions"])).toEqual([
      "client",
      "device",
      "status",
      "orderNumber",
      "total",
      "actions",
    ]);
  });

  it("keeps pinned end columns last even if stored earlier", () => {
    expect(mergeColumnOrder(["a", "b", "actions"], ["actions", "b", "a"], ["actions"])).toEqual([
      "b",
      "a",
      "actions",
    ]);
  });
});

describe("resolveTableColumnLayout", () => {
  it("ignores unknown widths and fills defaults for new columns", () => {
    const resolved = resolveTableColumnLayout({
      columnIds: ["orderNumber", "client", "actions"],
      defaultWidths: new Map([
        ["orderNumber", 100],
        ["client", 180],
        ["actions", 80],
      ]),
      stored: {
        order: ["client", "orderNumber", "ghost"],
        widths: { client: 220, ghost: 99 },
      },
      pinnedEndIds: ["actions"],
    });
    expect(resolved.order).toEqual(["client", "orderNumber", "actions"]);
    expect(resolved.widths.client).toBe(220);
    expect(resolved.widths.orderNumber).toBe(100);
    expect(resolved.widths.actions).toBe(80);
    expect(resolved.widths.ghost).toBeUndefined();
  });
});

describe("mergeColumnWidths", () => {
  it("clamps stored widths to min", () => {
    const widths = mergeColumnWidths(
      ["a"],
      new Map([["a", 120]]),
      { a: 10 },
      new Map([["a", 64]]),
    );
    expect(widths.a).toBe(64);
  });
});

describe("applyVisibleColumnReorder", () => {
  it("keeps hidden columns in their stored slots while reordering visible ones", () => {
    expect(
      applyVisibleColumnReorder(
        ["orderNumber", "client", "device", "status", "actions"],
        ["status", "orderNumber", "client"],
        ["actions"],
      ),
    ).toEqual(["status", "orderNumber", "device", "client", "actions"]);
  });
});
