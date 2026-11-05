import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "20261105100000_order_services_member_update.PRODUCTION.sql");

describe("order_services member UPDATE SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("grants UPDATE to authenticated and preserves select/insert/delete", () => {
    expect(sql).toMatch(/grant update on table public\.order_services to authenticated/i);
    expect(sql).toMatch(/grant select, insert, update, delete on table public\.order_services to authenticated/i);
    expect(sql).toMatch(/revoke all on table public\.order_services from public, anon/i);
    expect(sql).not.toMatch(/grant\s+update\s+on table public\.order_services to anon/i);
    expect(sql).not.toMatch(/grant\s+.*\s+on table public\.order_services to public/i);
  });

  it("adds an UPDATE RLS policy scoped via is_workspace_member on the parent order", () => {
    expect(sql).toMatch(/create policy "Members can update order services"/i);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/to authenticated/i);
    expect(sql).toMatch(/public\.is_workspace_member\(o\.workspace_id\)/i);
    expect(sql).toMatch(/with check/i);
    expect(sql).toMatch(/enable row level security/i);
  });

  it("does not alter order_materials, warranty tables, or lifecycle RPCs", () => {
    expect(sql).not.toMatch(/alter table public\.order_materials/i);
    expect(sql).not.toMatch(/warranty_records/i);
    expect(sql).not.toMatch(/close_order_if_settled/i);
    expect(sql).not.toMatch(/cancel_order/i);
    expect(sql).not.toMatch(/activate_order_warranties/i);
  });

  it("preflights required objects", () => {
    expect(sql).toMatch(/to_regclass\('public\.order_services'\)/);
    expect(sql).toMatch(/to_regclass\('public\.orders'\)/);
    expect(sql).toMatch(/to_regprocedure\('public\.is_workspace_member\(uuid\)'\)/);
  });
});
