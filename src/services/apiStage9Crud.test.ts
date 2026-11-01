import { describe, expect, it } from "vitest";
import { buildBookingRow } from "./apiBookings";
import { buildEstimateRow } from "./apiEstimates";
import { buildLeadRow } from "./apiLeads";
import { buildTaskRow } from "./apiTasks";

describe("buildLeadRow", () => {
  it("builds an inquiry row and trims text", () => {
    expect(buildLeadRow({ contactName: "  Ion  ", phone: " 069123456 ", leadType: "inquiry", isUrgent: true })).toEqual({
      lead_type: "inquiry",
      contact_name: "Ion",
      phone: "069123456",
      is_urgent: true,
    });
  });

  it("accepts a phone-only missed call", () => {
    const row = buildLeadRow({ contactName: "", phone: "069", leadType: "missed_call", isUrgent: false });
    expect(row).toMatchObject({ lead_type: "missed_call", contact_name: null, phone: "069", is_urgent: false });
  });

  it("requires a name or a phone", () => {
    expect(() => buildLeadRow({ contactName: " ", phone: "", leadType: "inquiry", isUrgent: false })).toThrow();
  });
});

describe("buildEstimateRow", () => {
  it("keeps number optional and mirrors the total into subtotal", () => {
    expect(buildEstimateRow({ number: " ", total: 1250.456 })).toEqual({ number: null, subtotal: 1250.46, total: 1250.46 });
    expect(buildEstimateRow({ number: "E-7", total: 0 })).toEqual({ number: "E-7", subtotal: 0, total: 0 });
  });

  it("rejects negative or non-finite totals", () => {
    expect(() => buildEstimateRow({ number: "", total: -1 })).toThrow();
    expect(() => buildEstimateRow({ number: "", total: Number.NaN })).toThrow();
  });
});

describe("buildTaskRow", () => {
  it("normalises priority and blank due date", () => {
    expect(buildTaskRow({ title: "  Call  ", priority: "high", dueAt: " " })).toEqual({ title: "Call", priority: "high", due_at: null });
    expect(buildTaskRow({ title: "x", priority: "bogus" as never, dueAt: "2026-11-02T10:00:00.000Z" })).toEqual({
      title: "x",
      priority: "medium",
      due_at: "2026-11-02T10:00:00.000Z",
    });
  });

  it("enforces the 256 character title limit and requires a title", () => {
    expect(() => buildTaskRow({ title: "", priority: "low", dueAt: null })).toThrow();
    expect(() => buildTaskRow({ title: "a".repeat(257), priority: "low", dueAt: null })).toThrow();
    expect(buildTaskRow({ title: "a".repeat(256), priority: "low", dueAt: null }).title).toHaveLength(256);
  });

  it("rejects an invalid due date", () => {
    expect(() => buildTaskRow({ title: "x", priority: "low", dueAt: "not-a-date" })).toThrow();
  });
});

describe("buildBookingRow", () => {
  const start = "2026-11-02T10:00:00.000Z";

  it("builds a scheduled manual booking", () => {
    expect(buildBookingRow({ startsAt: start, endsAt: "2026-11-02T11:00:00.000Z", comment: " Oil " })).toEqual({
      starts_at: start,
      ends_at: "2026-11-02T11:00:00.000Z",
      comment: "Oil",
      status: "scheduled",
      source: "manual",
    });
    expect(buildBookingRow({ startsAt: start, endsAt: null, comment: "" })).toMatchObject({ ends_at: null, comment: null });
  });

  it("requires a valid start and an end that is not before it", () => {
    expect(() => buildBookingRow({ startsAt: "", endsAt: null, comment: "" })).toThrow();
    expect(() => buildBookingRow({ startsAt: start, endsAt: "2026-11-02T09:00:00.000Z", comment: "" })).toThrow();
  });
});
