import { describe, expect, it } from "vitest";
import { industryProfile } from "../industries/industryProfile";
import { expandOrderCalendarEvents } from "./orderCalendar";

const order = {
  id: "o1",
  orderNumber: "ORD-1",
  deadline: "2026-11-20",
  createdAt: "2026-11-01",
  measurementAt: "2026-11-10T09:00:00.000Z",
  installationAt: "2026-11-18T14:00:00.000Z",
};

describe("expandOrderCalendarEvents project appointments", () => {
  it("adds measurement and installation events only when the profile enables them", () => {
    const furniture = industryProfile("furniture_manufacturing").orderFieldBlocks;
    const events = expandOrderCalendarEvents([order], furniture);
    expect(events.map((event) => event.kind).sort()).toEqual(["deadline", "installation", "measurement"]);
    expect(events.find((event) => event.kind === "measurement")?.dateKey).toBe("2026-11-10");
    expect(events.find((event) => event.kind === "installation")?.dateKey).toBe("2026-11-18");
  });

  it("does not emit measurement/installation for vehicle or device industries", () => {
    const auto = industryProfile("auto_repair").orderFieldBlocks;
    const device = industryProfile("phone_electronics_repair").orderFieldBlocks;
    expect(expandOrderCalendarEvents([order], auto).map((event) => event.kind)).toEqual(["deadline"]);
    expect(expandOrderCalendarEvents([order], device).map((event) => event.kind)).toEqual(["deadline"]);
  });
});
