import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "20261105180000_owner_manage_closed_orders_complete.PRODUCTION.sql",
);

describe("owner manage closed orders complete SQL", () => {
  const sql = readFileSync(sqlPath, "utf8");

  it("does not recreate the already-applied column or helper from 170000", () => {
    expect(sql).not.toMatch(/add column if not exists owner_can_manage_closed_orders/i);
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders/);
  });

  it("gates cancel/delete owner path on crm_owner_may_manage_closed_orders", () => {
    expect(sql).toMatch(/create or replace function public\.crm_has_closed_order_permission/);
    const body = sql.slice(sql.indexOf("create or replace function public.crm_has_closed_order_permission"));
    const fn = body.slice(0, body.indexOf("comment on function public.crm_has_closed_order_permission"));
    expect(fn).toMatch(/crm_owner_may_manage_closed_orders/);
    expect(fn).not.toMatch(/crm_is_workspace_owner_id/);
  });

  it("requires owner-manage for closed set_order_lifecycle_regular_custom_status", () => {
    expect(sql).toMatch(/set_order_lifecycle_regular_custom_status/);
    expect(sql).toMatch(/v_order\.closed_at is not null/);
    expect(sql).toMatch(/crm_owner_may_manage_closed_orders\(p_workspace_id\)/);
  });

  it("adds content guards for orders, services, and materials", () => {
    expect(sql).toMatch(/orders_closed_content_guard/);
    expect(sql).toMatch(/order_services_closed_guard/);
    expect(sql).toMatch(/order_materials_closed_guard/);
    expect(sql).toMatch(/crm_assert_closed_order_mutable/);
  });

  it("preserves closed_at immutability comments and preflight/postflight", () => {
    expect(sql).toMatch(/owner_manage_closed_orders_complete preflight failed/);
    expect(sql).toMatch(/owner_manage_closed_orders_complete postflight failed/);
    expect(sql).toMatch(/still uses bare owner_id/);
  });
});
