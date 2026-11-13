import { describe, expect, it } from "vitest";
import { decideCalendarSwipe } from "./calendarSwipe";

const start = { x: 100, y: 100, t: 1_000 };

describe("decideCalendarSwipe", () => {
  it("swipes left/right past ~50px threshold", () => {
    expect(
      decideCalendarSwipe(start, { x: 45, y: 105, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBe("next");
    expect(
      decideCalendarSwipe(start, { x: 160, y: 95, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBe("prev");
  });

  it("commits early on high horizontal velocity", () => {
    // 40px in 80ms ≈ 0.5 px/ms
    expect(
      decideCalendarSwipe(start, { x: 60, y: 102, t: 1_080 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBe("next");
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

  it("allows a quick swipe that started on an event", () => {
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_200 }, {
        startedOnEvent: true,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBe("next");
  });

  it("ignores a long hold on an event (that is a drag)", () => {
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_400 }, {
        startedOnEvent: true,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBeNull();
  });

  it("accepts slightly diagonal thumb swipes", () => {
    // dx=-70, dy=50 → ratio 1.4
    expect(
      decideCalendarSwipe(start, { x: 30, y: 150, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBe("next");
  });

  it("ignores while FullCalendar is dragging/selecting or UI is blocked", () => {
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: true,
      }),
    ).toBeNull();
    expect(
      decideCalendarSwipe(start, { x: 20, y: 100, t: 1_200 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
        blocked: true,
      }),
    ).toBeNull();
  });

  it("ignores slow short gestures", () => {
    expect(
      decideCalendarSwipe(start, { x: 70, y: 100, t: 1_400 }, {
        startedOnEvent: false,
        pointerCount: 1,
        fcBusy: false,
      }),
    ).toBeNull();
  });
});
