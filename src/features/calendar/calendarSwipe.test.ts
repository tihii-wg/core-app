import { describe, expect, it } from "vitest";
import { decideCalendarSwipe } from "./calendarSwipe";

const start = { x: 100, y: 100, t: 1_000 };

describe("decideCalendarSwipe", () => {
  it("swipes left/right past threshold", () => {
    expect(
      decideCalendarSwipe(start, { x: 20, y: 105, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBe("next");
    expect(
      decideCalendarSwipe(start, { x: 180, y: 95, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBe("prev");
  });

  it("ignores mostly-vertical scrolls", () => {
    expect(
      decideCalendarSwipe(start, { x: 130, y: 220, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBeNull();
  });

  it("ignores multi-touch", () => {
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 2,
        fcBusy: false,
      }),
    ).toBeNull();
  });

  it("ignores gestures that started on an event", () => {
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_200 }, {
        startedOnEvent: true,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBeNull();
  });

  it("ignores while FullCalendar is dragging/selecting", () => {
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: true,
      }),
    ).toBeNull();
  });

  it("ignores slow or short gestures", () => {
    expect(
      decideCalendarSwipe(start, { x: 50, y: 100, t: 1_100 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBeNull();
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_800 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBeNull();
  });
});
