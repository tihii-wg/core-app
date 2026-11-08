import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261108140000_order_payment_stages.PRODUCTION.sql"),
  "utf8",
);

describe("order_payment_stages SQL", () => {
  it("creates the stages table with mode checks and one remainder per order", () => {
    expect(sql).toMatch(/create table if not exists public\.order_payment_stages/);
    expect(sql).toMatch(/mode in \('percent', 'amount', 'remainder'\)/);
    expect(sql).toMatch(/order_payment_stages_one_remainder\s+on public\.order_payment_stages \(order_id\) where mode = 'remainder'/);
  });

  it("protects stages with RLS, consistency and the closed-order guard", () => {
    expect(sql).toMatch(/alter table public\.order_payment_stages enable row level security/);
    expect(sql).toMatch(/order_payment_stages:workspace_mismatch/);
    expect(sql).toMatch(/execute function public\.order_services_closed_guard\(\)/);
  });

  it("adds the workspace template and the min paid percent status rule", () => {
    expect(sql).toMatch(/add column if not exists payment_stage_template jsonb/);
    expect(sql).toMatch(/add column if not exists min_paid_percent numeric\(5,2\)/);
    expect(sql).toMatch(/before update of custom_status_id on public\.orders/);
    expect(sql).toMatch(/order_status:min_paid_required/);
  });

  it("changes no data and is transactional", () => {
    expect(sql).not.toMatch(/\bupdate public\.(orders|payments|workspaces|status_definitions)\s+set/i);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
  });
});
