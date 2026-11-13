import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261114090000_google_calendar_order_sync.PRODUCTION.sql"),
  "utf8",
);

describe("google_calendar_order_sync SQL", () => {
  it("is a DO block with preflight/postflight and schema reload", () => {
    expect(sql).toMatch(/do \$gcal_order_sync\$/);
    expect(sql).toMatch(/\$gcal_order_sync\$;/);
    expect(sql).toMatch(/gcal_order_sync preflight/);
    expect(sql).toMatch(/gcal_order_sync postflight/);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(sql).not.toMatch(/\bgrant\s+maintain\b/i);
  });

  it("adds visibility and sync columns with safe defaults", () => {
    expect(sql).toMatch(/add column if not exists team_access boolean not null default false/);
    expect(sql).toMatch(/add column if not exists sync_orders boolean not null default false/);
    expect(sql).toMatch(/add column if not exists sync_measurement boolean not null default false/);
    expect(sql).toMatch(/add column if not exists sync_installation boolean not null default false/);
    expect(sql).toMatch(/add column if not exists last_sync_error text/);
  });

  it("creates link + queue tables without authenticated writes", () => {
    expect(sql).toMatch(/create table if not exists public\.gcal_order_event_links/);
    expect(sql).toMatch(/field text not null check \(field in \('deadline', 'measurement', 'installation'\)\)/);
    expect(sql).toMatch(/create table if not exists public\.gcal_sync_queue/);
    expect(sql).toMatch(/revoke all on table public\.gcal_order_event_links from public, anon, authenticated/);
    expect(sql).toMatch(/grant all on table public\.gcal_sync_queue to service_role/);
  });

  it("trigger never raises and does not update orders", () => {
    expect(sql).toMatch(/crm_gcal_orders_enqueue_trigger/);
    expect(sql).toMatch(/exception when others then/);
    expect(sql).toMatch(/Never block order writes/);
    expect(sql).not.toMatch(/update\s+public\.orders\b/i);
  });

  it("excludes estimates in backfill and enqueues non-cancelled with recent dates", () => {
    expect(sql).toMatch(/crm_gcal_enqueue_backfill\(p_workspace_id uuid\)/);
    expect(sql).toMatch(/kind.*estimate|estimate.*kind/);
    expect(sql).toMatch(/is distinct from 'estimate'/);
    expect(sql).toMatch(/is distinct from 'cancelled'/);
    expect(sql).toMatch(/interval '7 days'/);
  });

  it("claim RPC uses for update skip locked", () => {
    expect(sql).toMatch(/crm_gcal_claim_sync_batch\(p_limit int\)/);
    expect(sql).toMatch(/for update skip locked/);
  });

  it("documents vault secret names and schedules cron every 2 minutes", () => {
    expect(sql).toMatch(/gcal_sync_function_url/);
    expect(sql).toMatch(/gcal_sync_cron_token/);
    expect(sql).toMatch(/google-calendar-order-sync/);
    expect(sql).toMatch(/\*\/2 \* \* \* \*/);
    expect(sql).toMatch(/x-gcal-cron-token/);
  });
});
