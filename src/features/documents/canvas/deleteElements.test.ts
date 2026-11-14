import { describe, expect, it } from "vitest";
import { defaultCanvasLayoutForType } from "./defaultCanvasLayouts";
import { createHistory, pushHistory, undoHistory } from "./history";
import type { CanvasElement } from "./types";

function el(id: string, locked = false): CanvasElement {
  return {
    id,
    type: "text",
    xMm: 0,
    yMm: 0,
    wMm: 40,
    hMm: 10,
    zIndex: 1,
    locked,
    content: id,
    style: { fontSizePt: 10, color: "#000000", align: "left", paddingMm: 0 },
  };
}

describe("delete + undo", () => {
  it("removes unlocked selected elements and restores via undo", () => {
    const initial = { ...defaultCanvasLayoutForType("work_order"), elements: [el("a"), el("b", true), el("c")] };
    let history = createHistory(initial);
    const selectedIds = ["a", "b", "c"];
    const next = {
      ...initial,
      elements: initial.elements.filter((item) => !selectedIds.includes(item.id) || item.locked),
    };
    history = pushHistory(history, next);
    expect(history.present.elements.map((e) => e.id)).toEqual(["b"]);
    history = undoHistory(history);
    expect(history.present.elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps locked elements when deleting selection", () => {
    const initial = { ...defaultCanvasLayoutForType("act"), elements: [el("locked", true)] };
    const selectedIds = ["locked"];
    const next = {
      ...initial,
      elements: initial.elements.filter((item) => !selectedIds.includes(item.id) || item.locked),
    };
    expect(next.elements).toHaveLength(1);
  });
});
