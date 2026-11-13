import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261114120000_google_calendar_multi.PRODUCTION.sql"),
  "utf8",
);

describe("google_calendar_multi SQL", () => {
  it("adds visible_calendars jsonb with empty array default", () => {
    expect(sql).toMatch(/do \$gcal_multi\$/);
    expect(sql).toMatch(/add column if not exists visible_calendars jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/gcal_multi postflight/);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(sql).not.toMatch(/\bgrant\s+maintain\b/i);
  });
});
