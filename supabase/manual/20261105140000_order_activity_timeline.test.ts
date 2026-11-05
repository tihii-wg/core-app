import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(__dirname, "20261105140000_order_activity_timeline.PRODUCTION.sql"), "utf8");

describe("order activity timeline SQL", () => {
  it("targets MAIN and requires existing order_events insert helpers", () => {
    expect(sql).toMatch(/pundggjzzaqzbvykbxvo/);
    expect(sql).toMatch(/DO NOT auto-apply/i);
    expect(sql).toMatch(/crm_order_event_insert/);
    expect(sql).toMatch(/crm_order_event_resolve_actor/);
  });

  it("adds payment, create, field, and warranty writers without dual-write from the app", () => {
    expect(sql).toMatch(/crm_payments_order_activity_event/);
    expect(sql).toMatch(/payment_recorded/);
    expect(sql).toMatch(/payment_refunded/);
    expect(sql).toMatch(/payment_voided/);
    expect(sql).toMatch(/settlement/);
    expect(sql).toMatch(/remaining_after/);
    expect(sql).toMatch(/payload->>'payment_id'/);
    expect(sql).toMatch(/order_created/);
    expect(sql).toMatch(/order_field_changed/);
    expect(sql).toMatch(/warranty_activated/);
    expect(sql).toMatch(/warranty_claim_created/);
    expect(sql).not.toMatch(/truncate\s+public\.order_events/i);
  });

  it("keeps status/custom_status out of the field trigger domain", () => {
    expect(sql).toMatch(/Lifecycle \/ status columns are owned by crm_orders_status_event/);
    expect(sql).not.toMatch(/v_changes := v_changes \|\| jsonb_build_object\('status'/);
  });
});
