import { describe, expect, it } from "vitest";
import {
  buildDesiredOrderEvents,
  dateToEventTimes,
  hashDesiredEvent,
  type OrderSyncSource,
} from "./orderSyncDesiredEvent";

const baseOrder = (): OrderSyncSource => ({
  id: "ord-1",
  number: "ORD-100",
  kind: "order",
  status: "in_progress",
  statusLabel: "In progress",
  cancelled: false,
  closed: false,
  clientName: "Acme",
  vehicleLabel: "Toyota · ABC123",
  firstServiceName: "Repair",
  itemLines: ["Repair", "Oil"],
  totalLabel: "100.00 MDL",
  deadline: "2026-11-20T00:00:00.000Z",
  measurementAt: "2026-11-18T10:00:00.000Z",
  installationAt: null,
});

describe("dateToEventTimes Europe/Chisinau", () => {
  it("maps midnight local to all-day", () => {
    // 2026-11-20 00:00 in Chisinau = 2026-11-19 22:00 UTC (EET +2)
    const midnightLocalAsUtc = "2026-11-19T22:00:00.000Z";
    const times = dateToEventTimes(midnightLocalAsUtc, "Europe/Chisinau");
    expect(times.allDay).toBe(true);
    expect(times.start).toBe("2026-11-20");
    expect(times.end).toBe("2026-11-21");
  });

  it("maps a date-only deadline (stored as 00:00 UTC) to all-day on that date", () => {
    const times = dateToEventTimes("2026-11-20T00:00:00+00:00", "Europe/Chisinau");
    expect(times.allDay).toBe(true);
    expect(times.start).toBe("2026-11-20");
    expect(times.end).toBe("2026-11-21");
  });

  it("maps timed local to 1-hour event", () => {
    const times = dateToEventTimes("2026-11-18T08:00:00.000Z", "Europe/Chisinau");
    expect(times.allDay).toBe(false);
    expect(times.timeZone).toBe("Europe/Chisinau");
    expect(times.end).toBe("2026-11-18T09:00:00.000Z");
  });
});

describe("buildDesiredOrderEvents", () => {
  it("returns none for estimates and cancelled", () => {
    expect(
      buildDesiredOrderEvents({
        order: { ...baseOrder(), kind: "estimate" },
        deleted: false,
        workspaceId: "ws",
        toggles: { syncOrders: true, syncMeasurement: true, syncInstallation: true },
        timeZone: "Europe/Chisinau",
        locale: "ru",
        openUrl: "https://app/orders?open=1",
      }),
    ).toEqual([]);

    expect(
      buildDesiredOrderEvents({
        order: { ...baseOrder(), cancelled: true },
        deleted: false,
        workspaceId: "ws",
        toggles: { syncOrders: true, syncMeasurement: false, syncInstallation: false },
        timeZone: "Europe/Chisinau",
        locale: "ru",
        openUrl: "https://app/orders?open=1",
      }),
    ).toEqual([]);
  });

  it("respects field toggles and prefixes", () => {
    const events = buildDesiredOrderEvents({
      order: baseOrder(),
      deleted: false,
      workspaceId: "ws",
      toggles: { syncOrders: true, syncMeasurement: true, syncInstallation: false },
      timeZone: "Europe/Chisinau",
      locale: "ru",
      openUrl: "https://app/ru/ws/orders?open=ord-1",
    });
    expect(events.map((e) => e.field)).toEqual(["deadline", "measurement"]);
    expect(events.find((e) => e.field === "measurement")?.title).toMatch(/^Замер:/);
    expect(events[0]?.description).toContain("https://app/ru/ws/orders?open=ord-1");
  });

  it("prefixes closed orders with checkmark", () => {
    const events = buildDesiredOrderEvents({
      order: { ...baseOrder(), closed: true, measurementAt: null },
      deleted: false,
      workspaceId: "ws",
      toggles: { syncOrders: true, syncMeasurement: false, syncInstallation: false },
      timeZone: "Europe/Chisinau",
      locale: "en",
      openUrl: "https://x",
    });
    expect(events[0]?.title.startsWith("✓ ")).toBe(true);
  });

  it("hash is stable for the same payload", () => {
    const [ev] = buildDesiredOrderEvents({
      order: { ...baseOrder(), measurementAt: null },
      deleted: false,
      workspaceId: "ws",
      toggles: { syncOrders: true, syncMeasurement: false, syncInstallation: false },
      timeZone: "Europe/Chisinau",
      locale: "ru",
      openUrl: "https://x",
    });
    expect(ev).toBeTruthy();
    expect(hashDesiredEvent(ev!)).toBe(hashDesiredEvent(ev!));
  });
});
