import { describe, expect, it } from "vitest";
import type { ActivityLogEntry } from "../../services/apiActivityLog";
import { activityLogCsv, activityLogSection, csvEscape, toCsv } from "./csvExport";

const entry = (over: Partial<ActivityLogEntry>): ActivityLogEntry => ({
  id: "1",
  createdAt: "2026-11-01T08:30:00.000Z",
  actorName: "Ada",
  entityType: "order",
  entityId: null,
  event: "status_changed",
  ...over,
});

describe("csvEscape", () => {
  it("quotes separators, quotes and newlines", () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe("");
  });

  it("neutralises spreadsheet formulas in text but keeps numbers", () => {
    expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvEscape("@cmd")).toBe("'@cmd");
    expect(csvEscape("-5 off")).toBe("'-5 off");
    expect(csvEscape(-5)).toBe("-5");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"');
  });
});

describe("activity log export", () => {
  const format = (date: Date) => date.toISOString().slice(0, 10);

  it("exports rows with a header and falls back for system actors and bad dates", () => {
    const csv = activityLogCsv([entry({}), entry({ id: "2", actorName: null, createdAt: "garbage", event: "=evil" })], format);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2026-11-01,Ada,order,status_changed");
    expect(lines[2].startsWith(",")).toBe(true);
    expect(lines[2]).toContain("'=evil");
  });

  it("builds a table section with the same rows", () => {
    const section = activityLogSection([entry({})], format);
    expect(section.kind).toBe("table");
    if (section.kind === "table") {
      expect(section.columns).toHaveLength(4);
      expect(section.rows[0]).toMatchObject({ when: "2026-11-01", actor: "Ada", entity: "order", event: "status_changed" });
    }
  });
});
