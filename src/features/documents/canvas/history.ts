import type { CanvasDocumentLayout } from "./types";

const MAX_HISTORY = 80;

export type CanvasHistory = {
  past: CanvasDocumentLayout[];
  present: CanvasDocumentLayout;
  future: CanvasDocumentLayout[];
};

export function createHistory(present: CanvasDocumentLayout): CanvasHistory {
  return { past: [], present: structuredClone(present), future: [] };
}

export function pushHistory(history: CanvasHistory, next: CanvasDocumentLayout): CanvasHistory {
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: structuredClone(next),
    future: [],
  };
}

export function undoHistory(history: CanvasHistory): CanvasHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory(history: CanvasHistory): CanvasHistory {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}
