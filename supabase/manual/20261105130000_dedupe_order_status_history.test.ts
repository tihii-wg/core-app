import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "20261105130000_dedupe_order_status_history.PRODUCTION.sql"),
  "utf8",
);

describe("dedupe order status history SQL", () => {
  it("is MAIN-only manual cleanup with preflight and postflight", () => {
    expect(sql).toMatch(/pundggjzzaqzbvykbxvo/);
    expect(sql).toMatch(/DO NOT auto-apply/i);
    expect(sql).toMatch(/preflight/i);
    expect(sql).toMatch(/postflight/i);
  });

  it("targets only status_changed duplicates with conservative criteria", () => {
    expect(sql).toMatch(/event_type = 'status_changed'/);
    expect(sql).toMatch(/interval '10 seconds'/);
    expect(sql).toMatch(/field_name = 'custom_status_id'/);
    expect(sql).toMatch(/field_name = 'status'/);
    expect(sql).not.toMatch(/truncate\s+public\.order_events/i);
    expect(sql).not.toMatch(/delete from public\.orders/i);
  });
});
