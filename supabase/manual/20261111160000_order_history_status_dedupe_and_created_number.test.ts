import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "20261111160000_order_history_status_dedupe_and_created_number.PRODUCTION.sql"),
  "utf8",
);

describe("order history status dedupe + created number SQL", () => {
  it("targets MAIN and must not be auto-applied", () => {
    expect(sql).toMatch(/pundggjzzaqzbvykbxvo/);
    expect(sql).toMatch(/DO NOT auto-apply/i);
  });

  it("reapplies status trigger v2 that skips paired custom_status_id rows", () => {
    expect(sql).toMatch(/crm_orders_status_event@v2/);
    expect(sql).toMatch(/v_status_changed/);
    expect(sql).toMatch(/and not v_status_changed/);
    expect(sql).not.toMatch(/truncate\s+public\.order_events/i);
  });

  it("syncs and backfills order_created snapshots from the real orders.number", () => {
    expect(sql).toMatch(/crm_orders_created_number_sync/);
    expect(sql).toMatch(/ORD-PENDING-%/);
    expect(sql).toMatch(/order_number/);
    expect(sql).toMatch(/event_type = 'order_created'/);
  });
});
