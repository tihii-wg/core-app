import { describe, expect, it, vi } from "vitest";
import { peekAdjacentActiveRange } from "./calendarPrefetch";
import type { CalendarApi } from "@fullcalendar/core";

function mockApi(ranges: Array<{ start: Date; end: Date }>): CalendarApi {
  let idx = 0;
  const current = new Date("2026-11-13T00:00:00.000Z");
  return {
    getDate: () => new Date(current),
    gotoDate: vi.fn(),
    next: vi.fn(() => {
      idx = Math.min(idx + 1, ranges.length - 1);
    }),
    prev: vi.fn(() => {
      idx = Math.max(idx - 1, 0);
    }),
    batchRendering: (fn: () => void) => fn(),
    view: {
      get activeStart() {
        return ranges[idx]!.start;
      },
      get activeEnd() {
        return ranges[idx]!.end;
      },
    },
  } as unknown as CalendarApi;
}

describe("peekAdjacentActiveRange", () => {
  it("returns next/prev ISO ranges and restores current date", () => {
    const ranges = [
      { start: new Date("2026-11-10T00:00:00.000Z"), end: new Date("2026-11-17T00:00:00.000Z") },
      { start: new Date("2026-11-17T00:00:00.000Z"), end: new Date("2026-11-24T00:00:00.000Z") },
    ];
    const api = mockApi(ranges);
    const next = peekAdjacentActiveRange(api, "next");
    expect(next).toEqual({
      from: "2026-11-17T00:00:00.000Z",
      to: "2026-11-24T00:00:00.000Z",
    });
    expect(api.gotoDate).toHaveBeenCalled();
    expect(api.next).toHaveBeenCalled();
  });
});
