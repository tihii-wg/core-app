import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GCAL_VIEW_STORAGE_KEY,
  defaultGcalView,
  readStoredGcalView,
  writeStoredGcalView,
} from "./calendarViewStorage";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calendarViewStorage", () => {
  it("defaults by device", () => {
    expect(defaultGcalView(true)).toBe("timeGridDay");
    expect(defaultGcalView(false)).toBe("timeGridWeek");
  });

  it("reads and writes valid views", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    writeStoredGcalView("dayGridMonth");
    expect(readStoredGcalView(true)).toBe("dayGridMonth");
  });

  it("falls back when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    });
    expect(readStoredGcalView(true)).toBe("timeGridDay");
    expect(() => writeStoredGcalView("timeGridWeek")).not.toThrow();
  });

  it("falls back on invalid stored values", () => {
    const store = memoryStorage();
    store.setItem(GCAL_VIEW_STORAGE_KEY, "not-a-view");
    vi.stubGlobal("localStorage", store);
    expect(readStoredGcalView(false)).toBe("timeGridWeek");
  });

  it("does not restore 3-day view as desktop default", () => {
    const store = memoryStorage();
    store.setItem(GCAL_VIEW_STORAGE_KEY, "timeGrid3Day");
    vi.stubGlobal("localStorage", store);
    expect(readStoredGcalView(false)).toBe("timeGridWeek");
    expect(readStoredGcalView(true)).toBe("timeGrid3Day");
  });
});
